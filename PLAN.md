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

## 🔴 CRITICAL: Dipendenze e SQLite

### Dipendenze (da package.json)

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.2.6",  // REGOLARE, NON PEER!
    "uuid": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "typescript": "^5.9.3",
    "esbuild": "^0.27.3"
  }
}
```

**⚠️ NON USARE:**
- ❌ `better-sqlite3` - DEPRECATO dalla 1.0.4 di PsychMem
- ❌ `@opencode-ai/plugin` come peer optional - CAUSA CRASH

### SQLite Strategy (Built-in, Zero Dipendenze)

PsychMem 1.0.5+ usa SQLite built-in, nessun native addon:

| Runtime | Module | Note |
|---------|--------|------|
| **Bun** | `bun:sqlite` | Built-in |
| **Node 22+** | `node:sqlite` | Built-in, `DatabaseSync` |

```typescript
// src/storage/sqlite-adapter.ts (copiare da PsychMem)
export async function createDatabase(dbPath: string): Promise<SqliteDatabase> {
  if (isBun()) {
    const { Database } = await import('bun:sqlite');
    return new Database(dbPath);
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(dbPath);
  }
}
```

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

## Database Schema (da PsychMem)

```sql
-- Schema version table
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT,
  transcript_path TEXT,
  transcript_watermark INTEGER DEFAULT 0,
  message_watermark INTEGER DEFAULT 0
);

-- Events table (raw hook events)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  hook_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Memory units table (consolidated memories)
CREATE TABLE IF NOT EXISTS memory_units (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  store TEXT NOT NULL,           -- 'stm' or 'ltm'
  classification TEXT NOT NULL,  -- bugfix, learning, constraint, etc.
  summary TEXT NOT NULL,
  source_event_ids TEXT NOT NULL,
  project_scope TEXT,            -- Project path for project-level, NULL for user-level
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  
  recency REAL NOT NULL DEFAULT 0,
  frequency INTEGER NOT NULL DEFAULT 1,
  importance REAL NOT NULL DEFAULT 0.5,
  utility REAL NOT NULL DEFAULT 0.5,
  novelty REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.5,
  interference REAL NOT NULL DEFAULT 0,
  
  strength REAL NOT NULL DEFAULT 0.5,
  decay_rate REAL NOT NULL,
  decay_type TEXT,               -- 'temporal' or 'explicit' (True-Memory addition)
  
  tags TEXT,
  associations TEXT,
  
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_store ON memory_units(store);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_units(status);
CREATE INDEX IF NOT EXISTS idx_memory_strength ON memory_units(strength);
CREATE INDEX IF NOT EXISTS idx_memory_classification ON memory_units(classification);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_units(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_project_scope ON memory_units(project_scope);
CREATE INDEX IF NOT EXISTS idx_memory_status_strength ON memory_units(status, strength);
```

---

## Hooks (da PsychMem OpenCode Adapter)

### Event Hook

```typescript
event: async ({ event }) => {
  switch (event.type) {
    case 'session.created':
      // Create session, inject memories
      break;
    case 'session.idle':
      // Extract memories from new messages (incremental)
      break;
    case 'session.deleted':
    case 'session.error':
      // End session
      break;
    case 'message.updated':
      // Per-message extraction (v1.9)
      break;
  }
}
```

### Tool Execute After Hook

```typescript
'tool.execute.after': async (input, output) => {
  // Capture tool results for context
  // input: { tool, sessionID, callID, args }
  // output: { title, output, metadata }
}
```

### Compaction Hook

```typescript
'experimental.session.compacting': async (input, output) => {
  // Phase 1: EXTRACT memories before compaction
  // Phase 2: INJECT memories into compaction prompt
  // output.prompt = buildCompactionPrompt(memories)
}
```

---

## Config Defaults

```typescript
const DEFAULT_CONFIG = {
  agentType: 'opencode',
  dbPath: '~/.true-memory/memory.db',
  
  // Decay rates (per hour)
  stmDecayRate: 0.05,     // ~32-hour half-life
  ltmDecayRate: 0.01,     // Slow decay
  
  // Consolidation thresholds
  stmToLtmStrengthThreshold: 0.7,
  stmToLtmFrequencyThreshold: 3,
  
  // Scoring weights
  scoringWeights: {
    recency: 0.20,
    frequency: 0.15,
    importance: 0.25,
    utility: 0.20,
    novelty: 0.10,
    confidence: 0.10,
    interference: -0.10,
  },
  
  // Working memory limit
  maxMemoriesPerStop: 7,
  maxMemoriesPerInjection: 10,
  
  // Message extraction
  messageWindowSize: 3,
  messageImportanceThreshold: 0.5,
  
  // Deduplication
  deduplicationThreshold: 0.7,
  
  // Auto-promote to LTM
  autoPromoteToLtm: ['bugfix', 'learning', 'decision'],
  
  // Decay (True-Memory improvement)
  decayThreshold: 0.1,
  applyDecayOnlyToEpisodic: true,  // Miglioramento #1
};
```

---

## Architettura File

```
true-memory/
├── src/
│   ├── index.ts                 # Entry point (plugin.js style)
│   ├── types.ts                 # Type definitions
│   ├── config.ts                # Default config
│   ├── logger.ts                # File-based logger
│   ├── storage/
│   │   ├── sqlite-adapter.ts    # bun:sqlite / node:sqlite
│   │   └── database.ts          # MemoryDatabase class
│   ├── memory/
│   │   ├── patterns.ts          # Multilingual patterns (659 lines from PsychMem)
│   │   ├── structural.ts        # Structural analysis
│   │   ├── scorer.ts            # Feature scoring
│   │   ├── context-sweep.ts     # Stage 1 extraction
│   │   ├── selective-memory.ts  # Stage 2 allocation
│   │   ├── retrieval.ts         # Contextual retrieval
│   │   └── decay.ts             # Decay logic
│   └── adapters/
│       └── opencode/
│           └── index.ts         # OpenCode adapter
├── package.json
├── tsconfig.json
├── .gitignore
├── AGENTS.md
└── PLAN.md
```

---

## Fasi di Implementazione

### FASE 1: Foundation (MVP)

**Obiettivo**: Plugin funzionante che carica senza crashare.

#### Step 1.1: Setup progetto

```bash
cd ~/Documents/_PROGETTI/true-memory

# package.json (manuale, vedere sezione dipendenze)
# tsconfig.json
# .gitignore
```

#### Step 1.2: Struttura cartelle

```bash
mkdir -p src/{storage,memory,adapters/opencode}
touch src/index.ts
touch src/types.ts
touch src/config.ts
touch src/logger.ts
touch src/storage/sqlite-adapter.ts
touch src/storage/database.ts
touch src/memory/patterns.ts
touch src/memory/scorer.ts
touch src/memory/retrieval.ts
touch src/memory/decay.ts
touch src/adapters/opencode/index.ts
```

#### Step 1.3: File base (copiare da PsychMem)

| File | Fonte | Note |
|------|-------|------|
| `sqlite-adapter.ts` | `psychmem/src/storage/sqlite-adapter.ts` | 128 righe, adattare |
| `database.ts` | `psychmem/src/storage/database.ts` | 937 righe, adattare schema |
| `patterns.ts` | `psychmem/src/memory/patterns.ts` | 659 righe, copia completa |
| `types.ts` | `psychmem/src/types/index.ts` | 541 righe, adattare |
| `opencode/index.ts` | `psychmem/src/adapters/opencode/index.ts` | 1055 righe, adattare |

#### Step 1.4: Logger (file-based)

```typescript
// src/logger.ts
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LOG_DIR = join(homedir(), '.true-memory');
const LOG_FILE = join(LOG_DIR, 'plugin-debug.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export function log(message: string, data?: unknown): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    
    // Rotate if log exceeds 10 MB
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size >= LOG_MAX_BYTES) {
        renameSync(LOG_FILE, join(LOG_DIR, 'plugin-debug.log.1'));
      }
    } catch { /* ignore */ }
    
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    appendFileSync(LOG_FILE, entry);
  } catch {
    // Silently ignore
  }
}
```

**⚠️ CRITICAL**: NON usare `ctx.client.app.log()` nel default export o prima che ctx sia pronto.

#### Step 1.5: Entry Point (plugin.js style)

```typescript
// src/index.ts
import type { Plugin } from '@opencode-ai/plugin';
import { createTrueMemoryPlugin } from './adapters/opencode/index.js';
import { log } from './logger.js';

const TrueMemory: Plugin = async (ctx) => {
  log('Plugin loading started');
  return await createTrueMemoryPlugin(ctx);
};

export default TrueMemory;
```

**⚠️ CRITICAL**: 
- NO init pesante nel default export
- NO ctx.client.app.log() nel default export
- Init lazy dentro `createTrueMemoryPlugin`

#### Step 1.6: Build e Test

```bash
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
- [ ] Log creato in `~/.true-memory/plugin-debug.log`
- [ ] Database creato in `~/.true-memory/memory.db`

---

### FASE 2-7: Vedi sezioni precedenti nel PLAN originale

(L'implementazione dettagliata delle fasi successive rimane invariata)

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

## Checklist Pre-Commit

- [ ] `npm run build` senza errori
- [ ] Plugin carica senza crash in OpenCode
- [ ] Log funzionante in `~/.true-memory/plugin-debug.log`
- [ ] Database creato in `~/.true-memory/memory.db`
- [ ] Lazy initialization implementata
- [ ] Nessuna dipendenza da `ctx.client.app.log()` nel default export
- [ ] `@opencode-ai/plugin` come dipendenza REGOLARE (non peer)
- [ ] SQLite con bun:sqlite o node:sqlite (NO better-sqlite3)

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
sqlite3 ~/.true-memory/memory.db "SELECT COUNT(*) FROM memory_units;"

# User-level memories
sqlite3 ~/.true-memory/memory.db "SELECT classification, summary FROM memory_units WHERE project_scope IS NULL;"

# By classification
sqlite3 ~/.true-memory/memory.db "SELECT classification, COUNT(*) FROM memory_units GROUP BY classification;"
```

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Per codice di riferimento
- [PsychMem locale](~/Documents/_PROGETTI/psychmem) - Per copia file
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Per struttura plugin funzionante
- [OpenCode plugin docs](https://github.com/opencode-ai/opencode) - Per API SDK

---

## Note Implementative

### Evita questi errori di PsychMem

1. **NON** usare peer dependency optional per `@opencode-ai/plugin` → CAUSA CRASH
2. **NON** usare `ctx.client.app.log()` nel default export → CAUSA CRASH
3. **NON** fare init sincrono di SQLite nel default export → BLOCCA
4. **NON** usare `better-sqlite3` → DEPRECATO, usa built-in
5. **NON** iniettare tutte le memorie - usa retrieval contestuale
6. **NON** applicare decay a tutte le memorie - solo episodic
7. **NON** penalizzare automaticamente interferenze - usa LLM reconsolidation

### Pattern da seguire

1. `@opencode-ai/plugin` come dipendenza REGOLARE
2. File-based logger in `~/.true-memory/`
3. Default export pulito, init lazy
4. SQLite: `bun:sqlite` o `node:sqlite` (built-in)
5. Copiare file da PsychMem e adattare, non riscrivere da zero

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
tail -f ~/.true-memory/plugin-debug.log

# Query DB
sqlite3 ~/.true-memory/memory.db ".schema"
sqlite3 ~/.true-memory/memory.db "SELECT COUNT(*) FROM memory_units;"

# Clear memories (nuclear option)
rm ~/.true-memory/memory.db*
```

---

## Status

- **Creato**: 22/02/2026
- **Aggiornato**: 22/02/2026
- **Stato**: Piano completo con info corrette da PsychMem 1.0.5
- **Fase corrente**: FASE 1 - Foundation
- **Prossimo step**: Step 1.1 - Setup progetto
