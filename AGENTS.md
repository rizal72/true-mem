# True-Memory - AGENTS.md

## ⚠️ CRITICAL CONFIG

```
PROJECTS_ROOT = ~/Documents/_PROGETTI/
THIS_PROJECT  = ~/Documents/_PROGETTI/true-memory

DATABASE      = ~/.true-memory/memory.db
DEBUG_LOG     = ~/.true-memory/plugin-debug.log
OPENCODE_CFG  = ~/.config/opencode/opencode.jsonc
```

---

## 📁 Document Structure (Single Source of Truth)

| File | Scopo | Contenuto |
|------|-------|-----------|
| **AGENTS.md** | Context & Status | High-level overview, stato, config critiche |
| **PLAN.md** | Implementation | Step-by-step, architettura, codice |

### Regola

- **AGENTS.md** = WHAT & WHY (cosa è il progetto, perché esiste, stato attuale)
- **PLAN.md** = HOW (come implementare, step dettagliati, codice)

Quando PLAN.md è completato → rimane solo AGENTS.md come documentazione finale.

### AGENTS.md contiene
- ✅ Stato implementazione (checklist)
- ✅ Config critiche e path
- ✅ Bug risolti e lezioni imparate
- ✅ High-level overview (5 miglioramenti in 1 riga cadauno)
- ✅ Rimandi a PLAN.md per dettagli

### PLAN.md contiene
- ✅ Architettura dettagliata
- ✅ Step-by-step implementation
- ✅ Codice e pattern
- ✅ Decisioni tecniche con rationale

---

## ✅ CURRENT STATUS - FASE 1-7 COMPLETATE + VERIFICA IN CORSO

**Data ultimo aggiornamento**: 23/02/2026

### Stato Implementazione

| Componente | Status | Note |
|------------|--------|------|
| package.json | ✅ | Deps: @opencode-ai/plugin, @opencode-ai/sdk, uuid, @huggingface/transformers, bun-types |
| tsconfig.json | ✅ | ESM, Node 22+, strict |
| src/logger.ts | ✅ | File-based, rotate 10MB |
| src/config.ts | ✅ | Default config completo |
| src/types.ts | ✅ | Types + SDK re-exports |
| src/storage/sqlite-adapter.ts | ✅ | bun:sqlite + node:sqlite |
| src/storage/database.ts | ✅ | MemoryDatabase class |
| src/memory/patterns.ts | ✅ | 670 lines, 15 languages |
| src/memory/negative-patterns.ts | ✅ | False positive prevention |
| src/memory/classifier.ts | ✅ | Three-layer defense + explicit intent |
| src/memory/embeddings.ts | ✅ | Transformers.js, cosine similarity, eval import trick |
| src/memory/reconsolidate.ts | ✅ | Vector-based conflict resolution |
| src/extraction/queue.ts | ✅ | Fire-and-forget extraction queue |
| src/adapters/opencode/index.ts | ✅ | Full extraction + injection + memory echo prevention |
| src/index.ts | ✅ | Entry point con fire-and-forget |
| **Build** | ✅ | `dist/index.js` (~81KB) - **BUN BUILD (Lean bundle via eval import)** |
| **TypeCheck** | ✅ | 0 errors |
| **Runtime Test** | ✅ | **FUNZIONA** |
| **Async Extraction** | ✅ | Fire-and-forget + 500ms debounce |
| **False Positive Prevention** | ✅ | Three-layer defense + explicit intent isolation |
| **Vector Embeddings** | ✅ | Working (Transformers.js local, @huggingface/transformers) |
| **Intelligent Decay** | ✅ | Only episodic, triggered on session start |
| **Reconsolidation** | ✅ | Vector-based heuristic (similarity thresholds, not LLM) |

### FASE 1-7 ✅ COMPLETATE

Plugin funzionante con:
- Caricamento senza crash (bun build)
- Estrazione asincrona non-blocking (ExtractionQueue)
- Prevenzione falsi positivi (negative patterns + multi-keyword + threshold)
- Retrieval e injection delle memorie
- **Vector Embeddings**: Ricerca semantica top-k (Transformers.js)
- **Intelligent Decay**: Decadimento solo per memorie episodiche
- **Reconsolidation**: Gestione duplicati e conflitti via similarità vettoriale

### FASE 6-7 ✅ COMPLETATE

Stato attuale:
- Implementata `ExtractionQueue` per elaborazione sequenziale in background.
- Implementata logica di riconsolidazione per evitare duplicati e gestire conflitti.
- Plugin pronto per il rilascio.

### 🟢 BUG RISOLTO: esbuild → bun build

**Sintomo originale**: OpenCode si avvia, schermo nero, prompt non appare mai.

**Root cause**: **esbuild con `--external` non è compatibile con OpenCode**. Il bundle funziona in Node puro ma crasha in OpenCode prima di eseguire qualsiasi codice.

**Soluzione**: Usare `bun build` invece di esbuild:

```json
{
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm && tsc --emitDeclarationOnly"
  },
  "devDependencies": {
    "bun-types": "^1.3.0"
  }
}
```

**Verifica**: Il bundle deve avere header `// @bun`:
```bash
head -1 dist/index.js
# → // @bun
```

### 🟢 FIX: Async Extraction (non-blocking UI)

**Problema**: PsychMem bloccava l'UI durante estrazione (ESC lento, progress bar continuava).

**Soluzione**: Fire-and-forget + debounce:
- `event` hook: `.then().catch()` invece di `await`
- `message.updated`: debounce 500ms
- `session.idle`: `queueMicrotask()`
- Solo `experimental.session.compacting` mantiene `await`

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Memory Echo Prevention

**Problema**: Il sistema estraeva il proprio contenuto iniettato ("## Relevant Memories...") creando un loop infinito di feedback.

**Soluzione**: Filtering in `extractConversationText` per saltare le parti contenenti marker di iniezione:
- Rileva pattern `## Relevant Memories` e marker correlati
- Salta queste parti durante l'estrazione
- Previene l'estrazione di memorie da memorie

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Transformers.js Bundling

**Problema**: `bun build` bundlea le import statiche di `@huggingface/transformers`, causando l'errore `pipeline is not a function` a runtime. Il modello non viene caricato correttamente perché `bun build` cerca di ottimizzare le import statiche.

**Soluzione**: Usare `eval('import(...)')` per import dinamiche completamente in `src/memory/embeddings.ts`:
- Tutte le import di `@huggingface/transformers` avvengono tramite `eval('import(...)')`
- Questo impedisce a `bun build` di bundleare o trasformare il codice di Transformers.js
- Il modello viene caricato correttamente a runtime (~43MB RAM, quantized)
- Funziona sia su Bun che su Node 22+ tramite fallback

**Cosa cambia nel codice**:
```typescript
// Instead of:
// import { pipeline, env } from '@huggingface/transformers';

// Use:
const { pipeline, env } = await eval('import("@huggingface/transformers")');
```

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Memory Echo Prevention (Robust)

**Problema**: Il filtering precedente di `extractConversationText` usava regex globali (`/.../g`) in un loop con `test()`, che causa comportamenti inaffidabili a causa di `lastIndex`. Inoltre, `processSessionIdle` saltava completamente l'estrazione se trovava un marker di iniezione.

**Soluzione**:
1. Rimuovere il flag `g` da tutti i regex in `injectionMarkers`
2. In `processSessionIdle`, invece di saltare l'intera estrazione, loggare un warning e procedere con il `conversationText` filtrato
3. Il filtering è ora robusto e l'estrazione continua anche se sono presenti marker di iniezione nel testo

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Explicit Intent Classification

**Problema**: Frasi esplicite come "Ricorda questo: preferisco sempre TypeScript a JavaScript" venivano classificate come `constraint` o `bugfix` a causa di keyword contestuali come "sempre" che venivano interpretate nel contesto globale.

**Soluzione**: Implementare `classifyWithExplicitIntent` in `src/memory/classifier.ts`:
- Se è presente un segnale `explicit_remember` ("Ricorda questo", "Remember this", ecc.)
- Isolare la frase dopo il marker (tramite regex e split per delimitatori)
- Classificare SOLO la frase isolata, non l'intero testo
- Rimuovere il contesto contaminante (es. altri messaggi nella conversazione)
- Questo garantisce che la classificazione rifletta l'intento esplicito dell'utente

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Multilingual Classification

**Problema**: Il classificatore non aveva keyword italiane, quindi le frasi in italiano non venivano classificate correttamente.

**Soluzione**: Aggiungere keyword italiane a tutte le categorie in `CLASSIFICATION_KEYWORDS`:
- `constraint`: 'non posso', 'proibito', 'vietato', 'mai', 'evita'
- `preference`: 'preferisco', 'piace', 'non mi piace', 'meglio'
- `decision`: 'deciso', 'scelto', 'abbiamo deciso'
- `learning`: 'imparato', 'scoperto', 'ho capito'
- `bugfix`: 'errore', 'bug', 'risolto', 'fixato'
- `procedural': 'passo', 'processo', 'workflow'

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Multi-Agent Noise

**Problema**: In multi-agent sessions, the plugin was extracting metadata from sub-agent communication (e.g., "748 messages" from `background_task`), causing noise in the memory database.

**Soluzione**: Implementare sub-agent detection in `src/adapters/opencode/index.ts`:
- Heuristic: Detect session IDs containing `-task-` (OpenCode convention for sub-sessions)
- Skip memory extraction for sub-agent sessions entirely
- This prevents tool-related metadata from being stored as memories

**Implementazione**:
```typescript
function isSubAgentSession(sessionId: string): boolean {
  return sessionId.includes('-task-');
}

// In handleSessionIdle:
if (isSubAgentSession(state.sessionId)) {
  logger.debug('Skipping extraction for sub-agent session', { sessionId: state.sessionId });
  return;
}
```

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Resource Leaks & Crashes

**Problema**: Transformers.js pipeline remained loaded indefinitely, causing Bun crashes and high CPU usage after prolonged sessions (~70% CPU, ~150MB RAM leak).

**Soluzione**: Implementare idle timeout e proper disposal in `src/memory/embeddings.ts`:
- 5-minute idle timeout per il pipeline
- Auto-dispose quando non usato per 5+ minuti
- Lazy reload al prossimo `embed()` call

**Implementazione**:
```typescript
let lastUsedTime = Date.now();
let idleTimeoutId: any = null;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function getPipeline(): Promise<any> {
  if (pipelineReady) {
    lastUsedTime = Date.now();
    resetIdleTimeout();
    return embeddingPipeline;
  }

  // ... load pipeline ...

  lastUsedTime = Date.now();
  resetIdleTimeout();
  return embeddingPipeline;
}

function resetIdleTimeout(): void {
  if (idleTimeoutId) {
    clearTimeout(idleTimeoutId);
  }
  
  idleTimeoutId = setTimeout(async () => {
    logger.info('Embedding pipeline idle timeout, disposing...');
    await disposePipeline();
  }, IDLE_TIMEOUT_MS);
}
```

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Meta-Talk Filtering

**Problema**: L'estrattore catturava tool-related content (e.g., `<tool_use>`, `<tool_result>`, JSON blobs), inquinando le memorie con meta-talk e noise.

**Soluzione**: Aggressive regex filtering in `src/adapters/opencode/index.ts`:
- Rimuovi `<tool_use>` e `<tool_result>` blocks
- Rimuovi JSON blobs (tool inputs/outputs)
- Rimuovi pattern di tool communication

**Implementazione**:
```typescript
const META_TALK_PATTERNS = [
  /<tool_use>[\s\S]*?<\/tool_use>/gi,
  /<tool_result>[\s\S]*?<\/tool_result>/gi,
  /<\|.*?\|>/g,  // XML-style tool tags
  /```\s*(json|tool_use|tool_result)[\s\S]*?```/gi,
  /\{[\s]*["']?tool["']?[\s]*:[\s\S]*?\}/g,
  /["']?tool["']?\s*:\s*\{[\s\S]*?\}/g,
];

function filterMetaTalk(text: string): string {
  let filtered = text;
  for (const pattern of META_TALK_PATTERNS) {
    filtered = filtered.replace(pattern, '');
  }
  return filtered;
}
```

Vedi `PLAN.md` per codice dettagliato.

### Dipendenze Corrette (package.json)

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.2.6",
    "@opencode-ai/sdk": "^1.2.6",
    "@huggingface/transformers": "^3.1.0",
    "uuid": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "@types/uuid": "^10.0.0",
    "bun-types": "^1.3.0",
    "typescript": "^5.9.3"
  }
}
```

**⚠️ CRITICAL**:
- `@opencode-ai/sdk` è RICHIESTO per importare `Message`, `Part`, `Event` types
- **NON usare esbuild** - causa crash in OpenCode
- **Usare bun build** - OpenCode è già basato su Bun

---

## Project Overview

**True-Memory** è un sistema di memoria persistente per AI coding agents (OpenCode), ispirato a [PsychMem](https://github.com/muratg98/psychmem) v1.0.5 ma con correzioni architetturali e miglioramenti.

### Perché non PsychMem diretto?

PsychMem 1.0.5 funziona ma ha causato crash nelle versioni precedenti:
- **Peer dependency opzionale** (`@opencode-ai/plugin`) → crash all'avvio (risolto in 1.0.5)
- **Logger SDK-dipendente** (`ctx.client.app.log()`) → crash se contesto non pronto
- **better-sqlite3** → deprecato dalla 1.0.4, ora usa built-in

### Perché True-Memory?

| Aspetto | PsychMem | True-Memory |
|---------|----------|-------------|
| Dipendenze | Peer optional (risolto 1.0.5) | Dipendenze regolari |
| Logger | SDK (può crashare) | File-based (robusto) |
| Init | Sync nel default export | Lazy, differita |
| Decay | Temporale su tutto | Solo episodico |
| Similarity | Jaccard (parole) | Vector embeddings (semantico) |
| Retrieval | Tutte le memorie | Top-k contestuali |

---

## 🔴 CRITICAL: Dipendenze e SQLite

### SQLite Strategy (Built-in, Zero Dipendenze)

| Runtime | Module | Note |
|---------|--------|------|
| **Bun** | `bun:sqlite` | Built-in |
| **Node 22+** | `node:sqlite` | Built-in, `DatabaseSync` |

```typescript
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

**⚠️ NON USARE:**
- ❌ `better-sqlite3` - DEPRECATO
- ❌ `@opencode-ai/plugin` come peer optional - CAUSA CRASH
- ❌ Operazioni bloccanti nel default export - BLOCCA OPENCODE

---

## I 6 Miglioramenti (dal feedback Reddit + analisi)

1. **Decay Intelligente** - Decay solo per `episodic`, le altre permangono
2. **Vector Embeddings** - Cosine similarity invece di Jaccard
3. **Retrieval Contestuale** - Top-k invece di injection globale
   - **Nota**: Intra-session retrieval è intenzionalmente limitato al session start/first message per evitare context bloat e oscillazioni semantiche. Cross-session continuity è l'obiettivo principale.
4. **Estrazione Asincrona** - Fire-and-forget per non bloccare l'UI
5. **Reconsolidation** - Valutazione conflitti via similarità vettoriale (non LLM)
6. **False Positive Prevention** - Three-layer defense (negative patterns + multi-keyword + threshold)

Vedi `PLAN.md` per i dettagli implementativi.

---

## Architettura Attuale

```
true-memory/
├── src/
│   ├── index.ts                 # Entry point with fire-and-forget
│   ├── types.ts                 # Type definitions + SDK re-exports
│   ├── config.ts                # Default config
│   ├── logger.ts                # File-based logger
│   ├── storage/
│   │   ├── sqlite-adapter.ts    # bun:sqlite + node:sqlite
│   │   └── database.ts          # MemoryDatabase class
│   ├── memory/
│   │   ├── patterns.ts          # Multilingual patterns (670 lines)
│   │   ├── negative-patterns.ts # False positive prevention
│   │   ├── classifier.ts        # Three-layer defense
│   │   ├── embeddings.ts        # Transformers.js, cosine similarity
│   │   └── reconsolidate.ts     # Vector-based conflict resolution
│   ├── extraction/
│   │   └── queue.ts             # Fire-and-forget extraction queue
│   └── adapters/
│       └── opencode/
│           └── index.ts         # Full extraction + injection
├── dist/
│   └── index.js                 # Bundle (1.6M)
├── package.json
├── tsconfig.json
├── .gitignore
├── AGENTS.md
└── PLAN.md
```

---

## Classificazioni Memorie

| Tipo | Decay | Store Default | Scope | Esempio |
|------|-------|---------------|-------|---------|
| **constraint** | Mai | STM | User (Global) | "Never use `var`" |
| **preference** | Mai | STM | User (Global) | "Prefers functional style" |
| **learning** | Mai | LTM (auto) | User (Global) | "Learned bun:sqlite API" |
| **procedural** | Mai | STM | User (Global) | "Run tests before commit" |
| **decision** | Mai | LTM (auto) | Project (Local) | "Decided SQLite over Postgres" |
| **bugfix** | Mai | LTM (auto) | Project (Local) | "Fixed null pointer in auth" |
| **semantic** | Mai | STM | Project (Local) | "API uses REST, not GraphQL" |
| **episodic** | Sì (7gg) | STM | Project (Local) | "Yesterday we refactored auth" |

**Dual-Scope Memory Logic**:
- User-scoped memories (constraint, preference, learning, procedural) are stored with `NULL project_scope` and are injected across **all projects**.
- Project-scoped memories (decision, bugfix, semantic, episodic) are tied to the **specific worktree path** and only injected when the current project matches.

---

## Plugin Installation

### Via file:// (sviluppo)

```json
{
  "plugin": [
    "file:///Users/riccardosallusti/Documents/_PROGETTI/true-memory"
  ]
}
```

---

## Database Initialization

Il plugin utilizza uno schema consolidato **v1.0.0** dal primo avvio. Non ci sono migrazioni v1 → v2; il database viene creato con lo schema finale completo.

**Schema consolidato v1.0.0**:
- `memories` tabella con tutti i campi necessari (type, scope, content, summary, store, embedding, strength, frequency, confidence, created_at, updated_at, last_accessed, decay_type)
- Indici ottimizzati per retrieval veloce (scope, type, store)
- Supporto completo per vector embeddings (BLOB storage)

**Path database**: `~/.true-memory/memory.db`

---

## Debug

```bash
# Visualizzare log
tail -f ~/.true-memory/plugin-debug.log

# Query database
sqlite3 ~/.true-memory/memory.db ".schema"

# Cercare errori
grep -i "error" ~/.true-memory/plugin-debug.log
```

---

## Git Workflow

**REGOLA**: Commit sempre e solo in locale. Push SOLO quando il plugin è testato e funzionante.

**Commit attuali**: 6 locali (non pushati)

### Best Practice: Background Tasks

Quando si lancia un task in background (`background_task`), NON controllare lo stato ogni 5 secondi. Attendi la notifica automatica di completamento. Questo evita spreco di token e rumore nei log.

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Codice di riferimento
- [PsychMem locale](~/Documents/_PROGETTI/psychmem) - Per copia file e PR bun build fix
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin funzionante di riferimento

---

## Confronto Tecnico: True-Memory vs PsychMem

**Premessa**: PsychMem ha aperto la strada alla memoria persistente per AI coding assistant. True-Memory è un'evoluzione architetturale basata sull'esperienza pratica.

**5 Aree di Miglioramento:**
- **Stabilità**: Init lazy e fire-and-forget per evitare blocchi all'avvio di OpenCode.
- **Build**: Bundle Bun-native stabile invece di esbuild (che causava crash).
- **Precisione**: Sistema di difesa a tre livelli (negative patterns + multi-keyword + threshold) per ridurre i falsi positivi.
- **Retrieval**: Vector embeddings (Transformers.js) e top-k contestuale invece di Jaccard similarity e iniezione globale.
- **Decay**: Decadimento intelligente solo per memorie episodiche; le preferenze e le decisioni rimangono permanenti.

---

## Notes

- **Creato**: 22/02/2026
- **Ispirato da**: [PsychMem](https://github.com/muratg98/psychmem) v1.0.5
- **Miglioramenti**: Basati su feedback Reddit r/opencodeCLI
- **Bug risolti**: esbuild → bun build fix, Transformers.js bundling, Memory Echo prevention, Explicit intent classification, Multilingual support, Multi-Agent noise detection, Resource leaks & crashes, Meta-talk filtering
- **Stato**: FASE 1-7 completate, plugin funzionante con vector embeddings attivi + production-ready stability fixes
