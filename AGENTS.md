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

### Dependencies (package.json)

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
- ❌ `better-sqlite3` - DEPRECATO dalla PsychMem 1.0.4
- ❌ `@opencode-ai/plugin` come peer optional - CAUSA CRASH

### SQLite Strategy (Built-in, Zero Dipendenze)

| Runtime | Module | Note |
|---------|--------|------|
| **Bun** | `bun:sqlite` | Built-in |
| **Node 22+** | `node:sqlite` | Built-in, `DatabaseSync` |

```typescript
// Copiare da psychmem/src/storage/sqlite-adapter.ts
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

## I 5 Miglioramenti (dal feedback Reddit)

### 1. Decay Intelligente (non solo temporale)

**Problema PsychMem**: Applica la curva di Ebbinghaus a TUTTE le memorie.

**Soluzione True-Memory**: Decay solo per `episodic`. Tutte le altre rimangono finché non revocate.

### 2. Vector Embeddings (non Jaccard)

**Problema PsychMem**: Jaccard similarity. "DB is broken" e "Postgres crashes" hanno similarità 0.0.

**Soluzione True-Memory**: Dense vector embeddings con cosine similarity.

### 3. Retrieval Contestuale (non injection globale)

**Problema PsychMem**: Inietta TUTTE le memorie → bloat context.

**Soluzione True-Memory**: Embedda il prompt, cerca top-k, inietta solo quelle.

### 4. Estrazione Asincrona (non blocking)

**Problema PsychMem**: Estrae dopo ogni messaggio, bloccando.

**Soluzione True-Memory**: Background processing, risponde subito.

### 5. Reconsolidation LLM (non interferenza automatica)

**Problema PsychMem**: Penalizza automaticamente se similarity 0.3-0.8.

**Soluzione True-Memory**: LLM eval: conflitto, complemento o duplicato?

---

## Architettura

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
│   │   ├── patterns.ts          # Multilingual patterns (659 lines)
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

### File da copiare da PsychMem

| File | Fonte | Righe |
|------|-------|-------|
| `sqlite-adapter.ts` | `psychmem/src/storage/sqlite-adapter.ts` | 128 |
| `database.ts` | `psychmem/src/storage/database.ts` | 937 |
| `patterns.ts` | `psychmem/src/memory/patterns.ts` | 659 |
| `types.ts` | `psychmem/src/types/index.ts` | 541 |
| `opencode/index.ts` | `psychmem/src/adapters/opencode/index.ts` | 1055 |

---

## Classificazioni Memorie

| Tipo | Decay | Store Default | Scope | Esempio |
|------|-------|---------------|-------|---------|
| **constraint** | Mai | STM | User | "Never use `var`" |
| **preference** | Mai | STM | User | "Prefers functional style" |
| **learning** | Mai | LTM (auto) | User | "Learned bun:sqlite API" |
| **procedural** | Mai | STM | User | "Run tests before commit" |
| **decision** | Mai | LTM (auto) | Project | "Decided SQLite over Postgres" |
| **bugfix** | Mai | LTM (auto) | Project | "Fixed null pointer in auth" |
| **semantic** | Mai | STM | Project | "API uses REST, not GraphQL" |
| **episodic** | Sì (7gg) | STM | Project | "Yesterday we refactored auth" |

### Scope

| Scope | Iniezione |
|-------|-----------|
| **user-level** | Sempre (constraint, preference, learning, procedural) |
| **project-level** | Solo se matching project (decision, bugfix, semantic, episodic) |

---

## Hooks OpenCode

```typescript
{
  // Session lifecycle
  event: async ({ event }) => {
    switch (event.type) {
      case 'session.created':    // Create session, inject memories
      case 'session.idle':       // Extract memories (incremental)
      case 'session.deleted':    // End session
      case 'session.error':      // End session (abandoned)
      case 'message.updated':    // Per-message extraction + lazy injection
    }
  },
  
  // Tool results
  'tool.execute.after': async (input, output) => {
    // Capture tool results
    // input: { tool, sessionID, callID, args }
    // output: { title, output, metadata }
  },
  
  // Compaction
  'experimental.session.compacting': async (input, output) => {
    // Phase 1: EXTRACT memories before compaction
    // Phase 2: INJECT memories into compaction prompt
    // output.prompt = buildCompactionPrompt(memories)
  },
}
```

---

## Lazy Injection (PR #2)

**Problema**: Sessioni continuate con `opencode -c` NON ricevono `session.created`, quindi niente memorie.

**Soluzione**: Lazy injection sul primo messaggio utente.

```typescript
injectedSessions: Set<string>;

// In handleMessageUpdated:
if (role === 'user' && !state.injectedSessions.has(sessionId)) {
  state.injectedSessions.add(sessionId);
  await injectContext(state, sessionId, memories);  // AWAIT prima di extraction!
}
```

| Scenario | Comportamento |
|----------|---------------|
| Nuova sessione | Injection su `session.created` |
| Sessione continuata, solo lettura | Nessuna injection |
| Sessione continuata, primo prompt utente | **Lazy injection** |
| Sessione continuata, prompt successivi | Già iniettato, skip |

---

## Plugin Installation

### Via file:// (sviluppo)

```json
{
  "plugin": ["file:///Users/riccardosallusti/Documents/_PROGETTI/true-memory"]
}
```

### Via npm (produzione)

```json
{
  "plugin": ["true-memory"]
}
```

---

## Logger

**⚠️ CRITICAL**: NON usare `ctx.client.app.log()` nel default export o prima che ctx sia pronto.

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
    
    // Rotate if > 10 MB
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size >= LOG_MAX_BYTES) {
        renameSync(LOG_FILE, join(LOG_DIR, 'plugin-debug.log.1'));
      }
    } catch {}
    
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    appendFileSync(LOG_FILE, entry);
  } catch {}
}
```

---

## Entry Point (plugin.js style)

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

---

## Debug

```bash
# Visualizzare log
tail -f ~/.true-memory/plugin-debug.log

# Query database
sqlite3 ~/.true-memory/memory.db ".schema"
sqlite3 ~/.true-memory/memory.db "SELECT COUNT(*) FROM memory_units;"
sqlite3 ~/.true-memory/memory.db "SELECT classification, summary FROM memory_units;"

# Cercare errori
grep -i "error" ~/.true-memory/plugin-debug.log
```

---

## Git Workflow

**REGOLA**: Commit sempre e solo in locale. Push SOLO quando il plugin è testato e funzionante.

```bash
# Durante sviluppo - SOLO commit locali
git add .
git commit -m "feat: descrizione"

# Quando il plugin è funzionante e testato
git push origin main
```

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Codice di riferimento
- [PsychMem locale](~/Documents/_PROGETTI/psychmem) - Per copia file
- [PR #2](https://github.com/muratg98/psychmem/pull/2) - Lazy injection (nostra, inclusa in 1.0.5)
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin funzionante di riferimento

---

## Notes

- **Creato**: 22/02/2026
- **Ispirato da**: [PsychMem](https://github.com/muratg98/psychmem) v1.0.5
- **Miglioramenti**: Basati su feedback Reddit r/opencodeCLI
- **PR #2**: Lazy injection per sessioni continuate
- **Obiettivo**: Plugin di memoria robusto, senza crash, semanticamente intelligente
