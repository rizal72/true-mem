# True-Memory - Implementation Plan

## Overview

Questo documento descrive il piano di implementazione di True-Memory, un plugin di memoria persistente per OpenCode.

**Obiettivo**: Un plugin che funziona come PsychMem (registrazione e iniezione automatica di memorie) ma SENZA i problemi di crash che hanno reso PsychMem inutilizzabile.

**Miglioramenti vs PsychMem** (dal feedback Reddit):
1. Decay solo per memorie episodiche (non semantiche)
2. Vector embeddings invece di Jaccard similarity
3. Retrieval contestuale top-k invece di injection globale
4. Estrazione asincrona non-blocking
5. Reconsolidation con LLM invece di penalità automatica

Leggi `AGENTS.md` per il context completo.

---

## Fondamenti Teorici (da PsychMem)

### Dual-Store Memory Model

True-Memory implementa il modello di Atkinson & Shiffrin con due store:

| Store | Decay Rate | Capacità | Contenuto |
|-------|------------|----------|-----------|
| **STM** (Short-Term) | λ = 0.05 (~32h half-life) | Limitata | Memorie temporanee, episodi |
| **LTM** (Long-Term) | λ = 0.01 (lento) | Illimitata | Memorie consolidate, fatti |

### Store Allocation Rules

| Classification | Default Store | Auto-Promote to LTM | Scope |
|----------------|---------------|---------------------|-------|
| `bugfix` | LTM | Sì | Project |
| `learning` | LTM | Sì | User |
| `decision` | LTM | Sì | Project |
| `constraint` | STM | No | User |
| `preference` | STM | No | User |
| `procedural` | STM | No | User |
| `semantic` | STM | No | Project |
| `episodic` | STM | No | Project |

### Consolidation Rules (STM → LTM)

Le memorie in STM vengono promosse a LTM quando:
- `strength >= 0.7` (alta importanza)
- `frequency >= 3` (accesso/mention ripetuto)
- Classification è auto-promote (`bugfix`, `learning`, `decision`)

### Decay Strategy

**PsychMem applica decay a TUTTE le memorie** → PROBLEMA: "User strict TypeScript" decade se non menzionato.

**True-Memory FIX**: Decay solo per `episodic`. Tutte le altre rimangono finché non revocate esplicitamente.

| Type | Decay Behavior |
|------|----------------|
| `episodic` | Temporale (Ebbinghaus curve) |
| Tutti gli altri | Esplicito (solo per reconsolidation conflict) |

---

## 7-Feature Scoring Model

```
Strength = Σ(wᵢ × fᵢ)
```

| Feature | Weight | Description | Calcolo |
|---------|--------|-------------|---------|
| **Recency** | 0.20 | Tempo dalla creazione | `1 - min(1, hours / 168)` |
| **Frequency** | 0.15 | Access count | `min(1, log(freq + 1) / log(10))` |
| **Importance** | 0.25 | Signal combination | Vedi sotto |
| **Utility** | 0.20 | Task usefulness | Feedback-adjusted |
| **Novelty** | 0.10 | Distanza da memorie esistenti | `1 - maxSimilarity` |
| **Confidence** | 0.10 | Evidence consensus | Per metodo estrazione |
| **Interference** | -0.10 | Conflict penalty | Solo se similarity 0.3-0.8 |

### Importance Calculation

```typescript
function calculatePreliminaryImportance(signals: ImportanceSignal[]): number {
  const sorted = signals.sort((a, b) => b.weight - a.weight);
  
  let importance = 0;
  for (let i = 0; i < sorted.length; i++) {
    importance += sorted[i].weight * Math.pow(0.7, i); // Diminishing returns
  }
  
  return Math.min(1, importance);
}
```

### Confidence per Extraction Method

| Method | Confidence | Rationale |
|--------|------------|-----------|
| Multilingual regex match | 0.75 | Explicit patterns are reliable |
| Structural analysis only | 0.50 | Typography/flow signals are suggestive |
| Tool event analysis | 0.60 | Errors/fixes are usually important |
| Repetition detection | 0.50 | Frequency suggests importance |

---

## Estrazione Memorie

### Two-Stage Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                     STAGE 1: CONTEXT SWEEP                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Multilingual │───▶│  Structural  │───▶│  Candidate   │       │
│  │   Patterns    │    │   Analysis   │    │  Extraction  │       │
│  │  (15 langs)   │    │ (typography) │    │              │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   STAGE 2: SELECTIVE MEMORY                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Feature    │───▶│   Strength   │───▶│    Store     │       │
│  │   Scoring    │    │  Calculation │    │  Allocation  │       │
│  │  (7 factors) │    │              │    │  (STM/LTM)   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1 - Multilingual Keyword Patterns (15 lingue)

| Signal Type | Examples | Weight |
|-------------|----------|--------|
| Explicit Remember | "remember this", "ricorda", "не забудь" | 0.9 |
| Emphasis Cue | "always", "sempre", "никогда" | 0.8 |
| Bug/Fix | "error", "errore", "ошибка" | 0.8 |
| Learning | "learned", "imparato", "узнал" | 0.8 |
| Correction | "actually", "in realtà", "на самом деле" | 0.7 |
| Decision | "decided", "deciso", "решил" | 0.7 |
| Constraint | "can't", "non posso", "нельзя" | 0.7 |
| Preference | "prefer", "preferisco", "предпочитаю" | 0.6 |

Lingue: English, Spanish, French, German, Portuguese, Japanese, Chinese, Korean, Russian, Arabic, Hindi, Italian, Dutch, Turkish, Polish

### Layer 2 - Structural Analysis (Language-Agnostic)

| Signal Type | Detection Method | Weight |
|-------------|------------------|--------|
| Typography Emphasis | ALL CAPS, `!!`, bold markdown | 0.7 |
| Correction Pattern | Short reply after long message | 0.6 |
| Repetition | Trigram overlap > 40% | 0.7 |
| Elaboration | Reply > 2× median length | 0.5 |
| Enumeration | Lists, "first/then/finally" | 0.5 |
| Meta Reference | Near tool errors, stack traces | 0.6 |

### Pre-Filter (Performance)

Prima di eseguire estrazione completa, skip messaggi low-signal:

```typescript
function preFilterImportance(content: string): boolean {
  return /remember|important|always|never|error|bug|fix|learned|decided|prefer|constraint/i.test(content);
}
```

### Deduplication

Threshold 70% keyword overlap per mergiare duplicati:

```typescript
deduplicationThreshold: 0.7  // If 70%+ words match, merge candidates
```

### Message Window

Sliding window di 3 messaggi per contesto:

```typescript
messageWindowSize: 3       // Include last 3 messages for context
messageImportanceThreshold: 0.5  // Only extract if importance >= 0.5
maxMemoriesPerStop: 7      // Miller's 7±2
```

---

## Injection & Retrieval

### Scoping

| Scope | Iniezione | Esempio |
|-------|-----------|---------|
| **User-Level** | Sempre | Constraints, preferences, learnings, procedural |
| **Project-Level** | Solo se matching project | Decisions, bugfixes, semantic, episodic |

### Contextual Retrieval (Miglioramento #3)

**PsychMem**: Inietta TUTTE le memorie user-level o project-level → bloat context.

**True-Memory**: Retrieval contestuale:
1. Embedda il prompt utente corrente
2. Vector search nel DB per top-k più simili
3. Inietta solo quelle

```typescript
function getRelevantMemories(userPrompt: string, projectPath: string, k: number = 10): Memory[] {
  const promptEmbedding = await embed(userPrompt);
  
  // Cerca top-k per similarità semantica
  const candidates = await vectorSearch(promptEmbedding, k * 2);
  
  // Filtra per scope
  return candidates.filter(m => 
    m.scope === 'user' || m.scope === projectPath
  ).slice(0, k);
}
```

---

## Text Similarity

### Jaccard (Baseline / Fallback)

```typescript
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
}
```

### Vector Embeddings (Miglioramento #2)

**PsychMem**: Jaccard → "DB is broken" e "Postgres crashes" hanno similarità 0.0.

**True-Memory**: Dense vector embeddings con cosine similarity:

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
```

Opzioni embeddings:
1. **OpenAI text-embedding-3-small** (richiede API key) - Raccomandato
2. **Local transformers.js** (nessuna API, più lento) - Fallback

---

## Decay & Reconsolidation

### Decay Formula (Ebbinghaus)

```typescript
function applyDecay(memory: Memory, dtHours: number): number {
  const lambda = memory.store === 'STM' ? 0.05 : 0.01;
  return memory.strength * Math.exp(-lambda * dtHours);
}
```

**Miglioramento #1**: Applica solo a `episodic`. Rimuovi memorie con S < 0.1.

### Reconsolidation (Miglioramento #5)

**PsychMem**: Penalizza automaticamente se similarity 0.3-0.8 → distruttivo.

**True-Memory**: LLM evaluation:

```typescript
async function reconsolidate(mem1: Memory, mem2: Memory): Promise<'conflict' | 'complement' | 'duplicate'> {
  const prompt = `Are these two statements:
1. "${mem1.content}"
2. "${mem2.content}"

Do they: conflict, complement, or duplicate each other?`;

  const result = await llm(prompt); // Small, fast model
  return result as 'conflict' | 'complement' | 'duplicate';
}
```

Azioni:
- `conflict`: mantieni la più recente
- `complement`: mantieni entrambe
- `duplicate`: mergia

---

## Fasi di Implementazione

### FASE 1: Foundation (MVP)

**Obiettivo**: Plugin funzionante che carica senza crashare.

#### Step 1.1: Setup progetto

```bash
cd ~/Documents/_PROGETTI/true-memory
npm init -y
npm install @opencode-ai/plugin uuid better-sqlite3
npm install -D typescript @types/node @types/better-sqlite3 esbuild
```

#### Step 1.2: Configurazione TypeScript

Crea `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Step 1.3: Struttura cartelle

```bash
mkdir -p src/{memory,extraction,hooks}
touch src/index.ts
touch src/types.ts
touch src/logger.ts
touch src/config.ts
touch src/memory/store.ts
touch src/memory/classifications.ts
touch src/memory/decay.ts
touch src/extraction/patterns.ts
touch src/extraction/scorer.ts
touch src/extraction/extract.ts
touch src/hooks/session.ts
touch src/hooks/message.ts
touch src/hooks/injection.ts
```

#### Step 1.4: Logger (file-based)

Crea `src/logger.ts`:
- File-based logging in `~/.true-memory/debug.log`
- **CRITICAL**: NO dipendenza da `ctx.client.app.log()`
- Funzione `log(message, data?)`
- Funzione `logError(message, error?)`

#### Step 1.5: Types

Crea `src/types.ts`:
- Importa tipi da `@opencode-ai/plugin`
- Definisci `Memory`, `MemoryType`, `MemoryScope`, `MemoryStore`
- Definisci `ImportanceSignal`, `MemoryFeatureVector`
- Definisci `TrueMemoryConfig` con defaults

#### Step 1.6: Config & Defaults

Crea `src/config.ts`:

```typescript
export const DEFAULT_CONFIG: TrueMemoryConfig = {
  // Decay rates (per hour)
  stmDecayRate: 0.05,     // ~32-hour half-life
  ltmDecayRate: 0.01,     // Slow decay for LTM
  
  // Consolidation thresholds
  stmToLtmStrengthThreshold: 0.7,
  stmToLtmFrequencyThreshold: 3,
  
  // Scoring weights (sum to ~1.0)
  scoringWeights: {
    recency: 0.20,
    frequency: 0.15,
    importance: 0.25,
    utility: 0.20,
    novelty: 0.10,
    confidence: 0.10,
    interference: -0.10,
  },
  
  // Working memory limit (Miller's 7±2)
  maxMemoriesPerStop: 7,
  maxMemoriesPerInjection: 10,
  
  // Message extraction
  messageWindowSize: 3,
  messageImportanceThreshold: 0.5,
  
  // Deduplication
  deduplicationThreshold: 0.7,
  
  // Auto-promote to LTM
  autoPromoteToLtm: ['bugfix', 'learning', 'decision'],
  
  // Decay
  decayThreshold: 0.1,
  applyDecayOnlyToEpisodic: true,  // MIGLIORAMENTO #1
};
```

#### Step 1.7: Classificazioni

Crea `src/memory/classifications.ts`:

```typescript
// Types that should decay over time (MIGLIORAMENTO #1: solo questi)
export const DECAYING_TYPES: MemoryType[] = ['episodic'];

// Types that only decay on explicit conflict
export const PERMANENT_TYPES: MemoryType[] = [
  'constraint', 'preference', 'decision', 
  'bugfix', 'learning', 'procedural', 'semantic'
];

// Always injected regardless of project
export const USER_LEVEL_TYPES: MemoryType[] = [
  'constraint', 'preference', 'learning', 'procedural'
];

// Only injected for matching project
export const PROJECT_LEVEL_TYPES: MemoryType[] = [
  'decision', 'bugfix', 'semantic', 'episodic'
];

// Store allocation (PsychMem compatible)
export const STM_DEFAULT_TYPES: MemoryType[] = [
  'constraint', 'preference', 'procedural', 'semantic', 'episodic'
];

export const LTM_DEFAULT_TYPES: MemoryType[] = [
  'bugfix', 'learning', 'decision'
];

// Confidence per extraction method
export const EXTRACTION_CONFIDENCE = {
  multilingualRegex: 0.75,
  structuralAnalysis: 0.50,
  toolEventAnalysis: 0.60,
  repetitionDetection: 0.50,
};
```

#### Step 1.8: Memory Store (SQLite)

Crea `src/memory/store.ts`:
- Classe `MemoryStore` con init lazy
- Database path: `~/.true-memory/memory.db`
- **WAL mode** (`PRAGMA journal_mode = WAL`) per concorrenza
- Schema DB:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,      -- 'user' or project path
  content TEXT NOT NULL,
  summary TEXT,             -- Short summary for injection
  store TEXT NOT NULL,      -- 'STM' or 'LTM'
  embedding BLOB,           -- For vector search (fase 4)
  strength REAL DEFAULT 1.0,
  frequency INTEGER DEFAULT 1,
  confidence REAL DEFAULT 0.5,
  created_at TEXT,
  updated_at TEXT,
  last_accessed TEXT,
  decay_type TEXT           -- 'temporal' or 'explicit'
);

CREATE INDEX idx_memories_scope ON memories(scope);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_store ON memories(store);
```

- Metodi:
  - `add(memory)` - con deduplication check
  - `get(id)` - incrementa frequency
  - `search(query, limit)` - basic text search
  - `getByScope(scope, types?, limit?)` - scope-aware retrieval
  - `consolidate()` - STM → LTM promotion
  - `decay()` - apply decay (solo episodic)
  - `delete(id)`
  - `getSimilar(embedding, threshold)` - per reconsolidation

#### Step 1.9: Entry Point

Crea `src/index.ts`:

```typescript
import type { Plugin } from '@opencode-ai/plugin';
import { log } from './logger';

let store: MemoryStore | null = null;

async function getStore(): Promise<MemoryStore> {
  if (!store) {
    store = await MemoryStore.create();
  }
  return store;
}

const TrueMemory: Plugin = async (ctx) => {
  log('Plugin loaded, lazy init pending');
  
  return {
    name: 'true-memory',
    
    event: async ({ event }) => {
      const s = await getStore(); // Lazy init here
      
      switch (event.type) {
        case 'session.created':
          // Handle session start
          break;
        case 'message.updated':
          // Handle message
          break;
      }
    },
  };
};

export default TrueMemory;
```

**CRITICAL**: 
- NO init pesante nel default export
- NO ctx.client.app.log() nel default export

#### Step 1.10: Build script

**⚠️ CRITICAL: USA BUN BUILD, NON TSC O ESBUILD!**

Aggiungi a `package.json`:
```json
{
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm && tsc --emitDeclarationOnly",
    "dev": "bun build src/index.ts --outdir dist --target bun --format esm --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "bun-types": "^1.3.0"
  }
}
```

**Verifica** che il bundle abbia header `// @bun`:
```bash
head -1 dist/index.js
# → // @bun
```

#### Step 1.11: Test locale

```bash
npm install
npm run build
```

Configura `opencode.jsonc`:
```json
{
  "plugin": ["file:///Users/riccardosallusti/Documents/_PROGETTI/true-memory"]
}
```

Avvia OpenCode e verifica:
- [ ] Plugin carica senza crash
- [ ] Log creato in `~/.true-memory/debug.log`
- [ ] Database creato in `~/.true-memory/memory.db`

### 🟢 BUG RISOLTO: esbuild → bun build

**Sintomo**: OpenCode si avvia, schermo nero, prompt non appare mai.

**Root cause**: esbuild con `--external` non è compatibile con OpenCode.

**Soluzione**: Usare `bun build`. Il bundle prodotto ha header `// @bun` che OpenCode riconosce.

### 🔴 CRITICAL: Async Extraction Architecture

**Problema**: PsychMem blocca l'UI durante estrazione (ESC lento, progress bar continua).

**Soluzione**: Fire-and-forget + debounce. Vedi sezione dettagliata più avanti nel documento.

---

### FASE 2: Memory Extraction

**Obiettivo**: Estrarre memorie dalle conversazioni con scoring completo.

#### Step 2.1: Pattern matching multilingua (COPIA COMPLETA DA PSYCHMEM)

Crea `src/extraction/patterns.ts` copiando da `/psychmem/src/memory/patterns.ts` (659 righe):

**8 categorie di segnali con weights:**
| Categoria | Weight | Esempio |
|-----------|--------|---------|
| `explicit_remember` | 0.9 | "remember this", "覚えておいて" |
| `emphasis_cue` | 0.8 | "always", "必ず", "دائما" |
| `bug_fix` | 0.8 | "error", "エラー", "خطأ" |
| `learning` | 0.8 | "learned", "学んだ", "تعلمت" |
| `correction` | 0.7 | "actually", "実は", "في الواقع" |
| `decision` | 0.7 | "decided", "決めた", "قررت" |
| `constraint` | 0.7 | "can't", "禁止", "ممنوع" |
| `preference` | 0.6 | "prefer", "好き", "أفضل" |

**15 lingue supportate:**
English, Spanish, French, German, Portuguese, Japanese, Chinese (Simplified/Traditional), Korean, Russian, Arabic, Hindi, Italian, Dutch, Turkish, Polish

**Struttura PatternCategory:**
```typescript
export interface PatternCategory {
  signalType: ImportanceSignalType;
  weight: number;
  latin: string[];      // Regex con \b word boundaries
  nonLatin: string[];   // Match via string.includes()
  compiledRegex?: RegExp; // Cached dopo primo uso
}
```

**Funzioni da copiare:**
- `compileLatinRegex(category): RegExp` - Compila e cache
- `matchNonLatin(text, keywords): string | null` - Per CJK/Arabic/Hindi
- `matchPattern(text, category): ImportanceSignal | null` - Singola categoria
- `matchAllPatterns(text): ImportanceSignal[]` - Tutte le categorie
- `classifyByPatterns(text): string | null` - Classificazione contenuto

**CLASSIFICATION_PATTERNS** (per inferire il tipo di memoria):
- `bugfix`: bug, error, fix, resolved...
- `learning`: learned, discovered, TIL...
- `constraint`: can't, forbidden, prohibited...
- `decision`: decided, chose, going with...
- `preference`: prefer, like, hate...
- `procedural`: step, workflow, process...

**Fonte:** `/Users/riccardosallusti/Documents/_PROGETTI/psychmem/src/memory/patterns.ts`

#### Step 2.2: Structural analyzer

Crea `src/extraction/structural.ts`:
- Typography emphasis detection (ALL CAPS, `!!`, bold)
- Correction pattern (short after long)
- Repetition detection (trigram overlap)
- Elaboration detection (length comparison)
- Enumeration detection
- Meta reference (near errors)

#### Step 2.3: Feature scorer completo

Crea `src/extraction/scorer.ts`:

```typescript
export function calculateStrength(features: MemoryFeatureVector, config: TrueMemoryConfig): number {
  const w = config.scoringWeights;
  
  // Normalize frequency (log scale for diminishing returns)
  const normalizedFrequency = Math.min(1, Math.log(features.frequency + 1) / Math.log(10));
  
  // Recency factor (0 = now, 1 = old; 168 hours = 1 week)
  const recencyFactor = 1 - Math.min(1, features.recency / 168);
  
  const strength =
    w.recency * recencyFactor +
    w.frequency * normalizedFrequency +
    w.importance * features.importance +
    w.utility * features.utility +
    w.novelty * features.novelty +
    w.confidence * features.confidence +
    w.interference * features.interference;  // Negative contribution

  return clamp(strength, 0, 1);
}

export function calculateNovelty(candidate: string, existingMemories: Memory[]): number {
  if (existingMemories.length === 0) return 1.0;
  
  let maxSimilarity = 0;
  for (const mem of existingMemories) {
    const similarity = jaccardSimilarity(candidate, mem.summary || mem.content);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }
  
  return 1 - maxSimilarity;
}

export function detectInterference(candidate: string, existingMemories: Memory[]): number {
  let interference = 0;
  
  for (const mem of existingMemories) {
    const similarity = jaccardSimilarity(candidate, mem.summary || mem.content);
    
    // Similar topic (0.3-0.8) but different content = potential conflict
    if (similarity > 0.3 && similarity < 0.8) {
      interference = Math.max(interference, similarity * 0.5);
    }
  }
  
  return interference;
}
```

#### Step 2.4: Extraction logic

Crea `src/extraction/extract.ts`:

```typescript
export async function extractMemories(
  messages: Message[],
  store: MemoryStore,
  config: TrueMemoryConfig
): Promise<Memory[]> {
  const candidates: MemoryCandidate[] = [];
  
  // Get message window
  const window = messages.slice(-config.messageWindowSize);
  const content = window.map(m => m.content).join('\n');
  
  // Pre-filter for efficiency
  if (!preFilterImportance(content)) {
    return [];
  }
  
  // Stage 1: Context Sweep
  const signals = [
    ...detectSignals(content),
    ...analyzeStructure(window),
  ];
  
  if (signals.length === 0) return [];
  
  // Calculate preliminary importance
  const importance = calculatePreliminaryImportance(signals);
  
  if (importance < config.messageImportanceThreshold) {
    return [];
  }
  
  // Stage 2: Selective Memory
  const existingMemories = await store.getRecent(50);
  
  const features: MemoryFeatureVector = {
    recency: 0, // Just created
    frequency: 1,
    importance,
    utility: 0.5, // Default
    novelty: calculateNovelty(content, existingMemories),
    confidence: getConfidence(signals),
    interference: detectInterference(content, existingMemories),
  };
  
  const strength = calculateStrength(features, config);
  
  // Determine classification from signals
  const classification = inferClassification(signals);
  
  // Determine store allocation
  const targetStore = config.autoPromoteToLtm.includes(classification) 
    ? 'LTM' 
    : 'STM';
  
  // Determine scope
  const scope = inferScope(signals, classification);
  
  candidates.push({
    type: classification,
    scope,
    content,
    summary: summarize(content),
    store: targetStore,
    strength,
    confidence: features.confidence,
    decay_type: DECAYING_TYPES.includes(classification) ? 'temporal' : 'explicit',
  });
  
  return candidates;
}
```

#### Step 2.5: Hook handlers

Crea `src/hooks/message.ts`:
- Hook `message.updated`
- Prendi sliding window di messaggi
- Chiama `extractMemories()`
- Salva candidates nel store (con deduplication)

---

### FASE 3: Memory Injection

**Obiettivo**: Iniettare memorie rilevanti nel context con retrieval contestuale.

#### Step 3.1: Session hooks

Crea `src/hooks/session.ts`:
- Hook `session.created`
- Lazy injection (solo al primo user message per sessioni continuate)
- Traccia `injectedSessions: Set<string>`

#### Step 3.2: Retrieval (basic first, contextual later)

Crea `src/memory/retrieval.ts`:

```typescript
export async function getRelevantMemories(
  store: MemoryStore,
  projectPath: string,
  limit: number = 10
): Promise<Memory[]> {
  // Get user-level memories (always)
  const userMemories = await store.getByScope('user', USER_LEVEL_TYPES, limit / 2);
  
  // Get project-level memories (matching project)
  const projectMemories = await store.getByScope(projectPath, PROJECT_LEVEL_TYPES, limit / 2);
  
  // Sort by strength, take top
  return [...userMemories, ...projectMemories]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);
}
```

#### Step 3.3: Injection

Crea `src/hooks/injection.ts`:

```typescript
export async function injectMemories(
  ctx: PluginContext,
  store: MemoryStore,
  projectPath: string,
  config: TrueMemoryConfig
): Promise<void> {
  const memories = await getRelevantMemories(store, projectPath, config.maxMemoriesPerInjection);
  
  if (memories.length === 0) return;
  
  const formatted = formatMemoriesForInjection(memories);
  
  await ctx.client.session.prompt({
    noReply: true,
    content: formatted,
  });
}

function formatMemoriesForInjection(memories: Memory[]): string {
  const sections: string[] = ['# True-Memory Context'];
  
  // Group by type
  const grouped = groupBy(memories, 'type');
  
  for (const [type, mems] of Object.entries(grouped)) {
    sections.push(`\n## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    for (const mem of mems) {
      sections.push(`- ${mem.summary || mem.content}`);
    }
  }
  
  return sections.join('\n');
}
```

---

### FASE 4: Vector Embeddings (Miglioramento #2)

**Obiettivo**: Retrieval semantico con embeddings invece di Jaccard.

#### Step 4.1: Embeddings module

Crea `src/memory/embeddings.ts`:

```typescript
import OpenAI from 'openai';

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI(); // Uses OPENAI_API_KEY env var
  }
  return openai;
}

export async function embed(text: string): Promise<number[]> {
  const client = getClient();
  
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  
  return response.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Fallback: transformers.js for local embeddings
export async function embedLocal(text: string): Promise<number[]> {
  // TODO: Implement with transformers.js
  // const { pipeline } = await import('@xenova/transformers');
  // const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  // const result = await extractor(text, { pooling: 'mean', normalize: true });
  // return Array.from(result.data);
  throw new Error('Local embeddings not implemented');
}
```

#### Step 4.2: Update Store for Vector Search

Aggiorna `src/memory/store.ts`:
- Salva embeddings come BLOB
- Funzione `vectorSearch(queryEmbedding, k): Memory[]`
- SQLite non supporta vector nativamente → cosine similarity in-memory

```typescript
async vectorSearch(queryEmbedding: number[], k: number): Promise<Memory[]> {
  const allMemories = this.db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL').all() as Memory[];
  
  const scored = allMemories.map(mem => {
    const memEmbedding = new Float32Array(mem.embedding);
    return {
      memory: mem,
      similarity: cosineSimilarity(queryEmbedding, Array.from(memEmbedding)),
    };
  });
  
  scored.sort((a, b) => b.similarity - a.similarity);
  
  return scored.slice(0, k).map(s => s.memory);
}
```

#### Step 4.3: Contextual Retrieval (Miglioramento #3)

Aggiorna `src/memory/retrieval.ts`:

```typescript
export async function getRelevantMemoriesContextual(
  store: MemoryStore,
  userPrompt: string,
  projectPath: string,
  k: number = 10
): Promise<Memory[]> {
  // Embed user prompt
  const promptEmbedding = await embed(userPrompt);
  
  // Vector search for top candidates
  const candidates = await store.vectorSearch(promptEmbedding, k * 2);
  
  // Filter by scope
  return candidates
    .filter(m => m.scope === 'user' || m.scope === projectPath)
    .slice(0, k);
}
```

---

### FASE 5: Intelligent Decay (Miglioramento #1)

**Obiettivo**: Decay solo per memorie episodiche.

#### Step 5.1: Decay logic

Aggiorna `src/memory/decay.ts`:

```typescript
export function applyDecay(
  memory: Memory,
  dtHours: number,
  config: TrueMemoryConfig
): { strength: number; shouldRemove: boolean } {
  // MIGLIORAMENTO #1: Solo episodic decay temporalmente
  if (config.applyDecayOnlyToEpisodic && memory.decay_type !== 'temporal') {
    return { strength: memory.strength, shouldRemove: false };
  }
  
  const lambda = memory.store === 'STM' ? config.stmDecayRate : config.ltmDecayRate;
  const newStrength = memory.strength * Math.exp(-lambda * dtHours);
  
  return {
    strength: newStrength,
    shouldRemove: newStrength < config.decayThreshold,
  };
}

export async function runDecay(store: MemoryStore, config: TrueMemoryConfig): Promise<number> {
  const memories = await store.getAll();
  let removed = 0;
  
  for (const mem of memories) {
    const dtHours = (Date.now() - new Date(mem.updated_at).getTime()) / (1000 * 60 * 60);
    const result = applyDecay(mem, dtHours, config);
    
    if (result.shouldRemove) {
      await store.delete(mem.id);
      removed++;
    } else if (result.strength !== mem.strength) {
      await store.updateStrength(mem.id, result.strength);
    }
  }
  
  return removed;
}
```

#### Step 5.2: Decay scheduling

Esegui decay:
- A ogni session start
- O ogni ora (con interval timer)

---

### FASE 6: Background Processing (Miglioramento #4)

**Obiettivo**: Estrazione asincrona non blocking.

#### Step 6.1: Queue system

Crea `src/extraction/queue.ts`:

```typescript
interface ExtractionJob {
  messages: Message[];
  projectPath: string;
  timestamp: number;
}

class ExtractionQueue {
  private queue: ExtractionJob[] = [];
  private processing = false;
  
  add(job: ExtractionJob): void {
    this.queue.push(job);
    this.processNext();
  }
  
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const job = this.queue.shift()!;
    
    try {
      const store = await getStore();
      const memories = await extractMemories(job.messages, store, DEFAULT_CONFIG);
      
      for (const mem of memories) {
        await store.add(mem);
      }
      
      log('Background extraction complete', { count: memories.length });
    } catch (error) {
      logError('Background extraction failed', error);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}

export const extractionQueue = new ExtractionQueue();
```

#### Step 6.2: Integration

Aggiorna `src/hooks/message.ts`:
- Aggiungi messaggio alla coda invece di processare subito
- L'agente risponde subito all'utente

```typescript
// Instead of:
// const memories = await extractMemories(messages, store, config);
// await store.add(memories);

// Do:
extractionQueue.add({ messages, projectPath, timestamp: Date.now() });
// Returns immediately, processing happens in background
```

---

### FASE 7: Reconsolidation (Miglioramento #5)

**Obiettivo**: Gestire interferenze con LLM invece di penalità automatiche.

#### Step 7.1: Interference detection

Aggiorna `src/memory/store.ts`:
- Quando aggiungi memoria, cerca simili con embeddings
- Se similarità > 0.7, marca per reconsolidation

```typescript
async add(memory: Memory): Promise<void> {
  // Check for similar memories
  if (memory.embedding) {
    const similar = await this.findSimilar(memory.embedding, 0.7);
    
    if (similar.length > 0) {
      // Queue for reconsolidation instead of auto-penalizing
      await queueForReconsolidation(memory, similar[0]);
      return;
    }
  }
  
  // Proceed with normal insertion
  this.insert(memory);
}
```

#### Step 7.2: LLM reconsolidation

Crea `src/memory/reconsolidate.ts`:

```typescript
export async function reconsolidate(
  mem1: Memory,
  mem2: Memory
): Promise<'conflict' | 'complement' | 'duplicate'> {
  const prompt = `Two memory entries have high semantic similarity.

Memory 1: "${mem1.summary || mem1.content}"
(type: ${mem1.type}, created: ${mem1.created_at})

Memory 2: "${mem2.summary || mem2.content}"
(type: ${mem2.type}, created: ${mem2.created_at})

Do these two statements:
- CONFLICT: They contradict each other (keep the newer one)
- COMPLEMENT: They add information to each other (keep both)
- DUPLICATE: They say the same thing (merge them)

Answer with only one word: CONFLICT, COMPLEMENT, or DUPLICATE`;

  // Use a small, fast model
  const response = await callLLM(prompt, { model: 'gpt-4o-mini' });
  
  const normalized = response.trim().toUpperCase();
  
  if (['CONFLICT', 'COMPLEMENT', 'DUPLICATE'].includes(normalized)) {
    return normalized as 'conflict' | 'complement' | 'duplicate';
  }
  
  // Default to complement (safe choice)
  return 'complement';
}

export async function handleReconsolidation(
  store: MemoryStore,
  newMem: Memory,
  existingMem: Memory
): Promise<void> {
  const result = await reconsolidate(newMem, existingMem);
  
  switch (result) {
    case 'conflict':
      // Keep the newer one
      if (new Date(newMem.created_at) > new Date(existingMem.created_at)) {
        await store.delete(existingMem.id);
        await store.add(newMem);
        log('Reconsolidation: conflict resolved, kept newer', { newId: newMem.id });
      } else {
        log('Reconsolidation: conflict resolved, kept existing', { existingId: existingMem.id });
      }
      break;
      
    case 'complement':
      // Keep both
      await store.add(newMem);
      log('Reconsolidation: complement detected, keeping both');
      break;
      
    case 'duplicate':
      // Merge: increment frequency of existing
      await store.incrementFrequency(existingMem.id);
      log('Reconsolidation: duplicate detected, incremented frequency');
      break;
  }
}
```

---

## Priorità

| Priorità | Fase | Descrizione |
|----------|------|-------------|
| **P0** | Fase 1 | Plugin funzionante (no crash) |
| **P0** | Fase 2 | Estrazione memorie completa |
| **P0** | Fase 3 | Injection con retrieval |
| **P1** | Fase 4 | Vector embeddings |
| **P1** | Fase 5 | Decay intelligente (solo episodic) |
| **P2** | Fase 6 | Background processing |
| **P2** | Fase 7 | Reconsolidation LLM |

---

## Checklist Pre-Commit (FASE 1)

- [x] `npm run build` senza errori (con **bun build**)
- [x] Plugin carica senza crash in OpenCode
- [x] Log funzionante in `~/.true-memory/plugin-debug.log`
- [x] Database creato in `~/.true-memory/memory.db`
- [x] Lazy initialization implementata
- [x] Async extraction (fire-and-forget + debounce)
- [x] Nessuna dipendenza da `ctx.client.app.log()`
- [x] `@opencode-ai/plugin` come dipendenza REGOLARE (non peer)
- [x] `@opencode-ai/sdk` come dipendenza (per types)
- [x] SQLite con bun:sqlite o node:sqlite (NO better-sqlite3)
- [x] **bun build** invece di esbuild (NO esbuild!)

---

## Testing

### Test manuale

1. Avvia OpenCode con plugin
2. Scrivi: "Remember that I always use TypeScript strict mode"
3. Chiudi sessione
4. Riapri OpenCode
5. Verifica che la memoria sia iniettata

### Test DB

```bash
# Schema
sqlite3 ~/.true-memory/memory.db ".schema"

# Count
sqlite3 ~/.true-memory/memory.db "SELECT COUNT(*) FROM memories;"

# User-level memories
sqlite3 ~/.true-memory/memory.db "SELECT type, content FROM memories WHERE scope='user';"

# By type
sqlite3 ~/.true-memory/memory.db "SELECT type, COUNT(*) FROM memories GROUP BY type;"

# Decay candidates
sqlite3 ~/.true-memory/memory.db "SELECT id, strength, decay_type FROM memories WHERE decay_type='temporal' AND strength < 0.3;"
```

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Per patterns multilingua
- [PsychMem locale](~/Documents/_PROGETTI/psychmem) - Per consultazione codice
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Per struttura plugin funzionante
- [OpenCode plugin docs](https://github.com/opencode-ai/opencode) - Per API SDK

---

## Note Implementative

### Evita questi errori di PsychMem

1. **NON** usare peer dependency optional per `@opencode-ai/plugin`
2. **NON** usare `ctx.client.app.log()` nel default export o prima che ctx sia pronto
3. **NON** fare init sincrono di SQLite nel default export
4. **NON** definire tipi localmente quando puoi importarli dal SDK
5. **NON** iniettare tutte le memorie - usa retrieval contestuale
6. **NON** applicare decay a tutte le memorie - solo episodic
7. **NON** penalizzare automaticamente interferenze - usa LLM reconsolidation

### Segui questi pattern di oh-my-opencode-slim

1. `@opencode-ai/plugin` come dipendenza REGOLARE
2. File-based logger in `~/.true-memory/`
3. Default export pulito, init lazy
4. Importa tipi dal SDK

---

## Commands

```bash
# Build
npm run build

# Watch mode
npm run dev

# Test in OpenCode (add to opencode.jsonc)
# "plugin": ["file:///Users/riccardosallusti/Documents/_PROGETTI/true-memory"]

# Check logs
tail -f ~/.true-memory/debug.log

# Query DB
sqlite3 ~/.true-memory/memory.db ".schema"
sqlite3 ~/.true-memory/memory.db "SELECT COUNT(*) FROM memories;"

# Clear memories (nuclear option)
rm ~/.true-memory/memory.db*
```

---

## Status

- **Creato**: 22/02/2026
- **Aggiornato**: 23/02/2026
- **FASE 1**: ✅ COMPLETATA (plugin funzionante con bun build + async extraction)
- **FASE 2**: ⏳ PRONTO DA IMPLEMENTARE
- **Fase corrente**: FASE 2 - Memory Extraction
- **Prossimo step**: Step 2.1 - Pattern matching multilingua
