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

## ✅ CURRENT STATUS - FASE 1 + ASYNC EXTRACTION

**Data ultimo aggiornamento**: 23/02/2026

### Stato Implementazione

| Componente | Status | Note |
|------------|--------|------|
| package.json | ✅ | Deps: @opencode-ai/plugin, @opencode-ai/sdk, uuid, bun-types |
| tsconfig.json | ✅ | ESM, Node 22+, strict |
| src/logger.ts | ✅ | File-based, rotate 10MB |
| src/config.ts | ✅ | Default config completo |
| src/types.ts | ✅ | Types + SDK re-exports |
| src/storage/sqlite-adapter.ts | ✅ | bun:sqlite + node:sqlite |
| src/storage/database.ts | ✅ | MemoryDatabase class |
| src/memory/patterns.ts | ✅ | 659 lines, 15 languages |
| src/adapters/opencode/index.ts | ✅ | Adapter con hooks + debounce |
| src/index.ts | ✅ | Entry point con fire-and-forget |
| **Build** | ✅ | `dist/index.js` (34kb) - **BUN BUILD** |
| **TypeCheck** | ✅ | 0 errors |
| **Runtime Test** | ✅ | **FUNZIONA** |
| **Async Extraction** | ✅ | Fire-and-forget + 500ms debounce |

### FASE 1 ✅ COMPLETATA

Plugin funzionante che carica senza crashare, con estrazione asincrona che non blocca l'UI.

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

### Dipendenze Corrette (package.json)

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.2.6",
    "@opencode-ai/sdk": "^1.2.6",
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

## I 5 Miglioramenti (dal feedback Reddit)

1. **Decay Intelligente** - Decay solo per `episodic`, le altre permangono
2. **Vector Embeddings** - Cosine similarity invece di Jaccard
3. **Retrieval Contestuale** - Top-k invece di injection globale
4. **Estrazione Asincrona** - Fire-and-forget per non bloccare l'UI
5. **Reconsolidation LLM** - Valutazione conflitti via LLM

Vedi `PLAN.md` per i dettagli implementativi.
LLM eval: conflitto, complemento o duplicato?

---

## Architettura Attuale

```
true-memory/
├── src/
│   ├── index.ts                 # Entry point ⚠️ DA FIXARE
│   ├── types.ts                 # Type definitions + SDK re-exports
│   ├── config.ts                # Default config
│   ├── logger.ts                # File-based logger
│   ├── storage/
│   │   ├── sqlite-adapter.ts    # bun:sqlite / node:sqlite
│   │   └── database.ts          # MemoryDatabase class
│   ├── memory/
│   │   └── patterns.ts          # Multilingual patterns (659 lines)
│   └── adapters/
│       └── opencode/
│           └── index.ts         # OpenCode adapter
├── dist/
│   └── index.js                 # Bundle (28.3kb)
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
| **constraint** | Mai | STM | User | "Never use `var`" |
| **preference** | Mai | STM | User | "Prefers functional style" |
| **learning** | Mai | LTM (auto) | User | "Learned bun:sqlite API" |
| **procedural** | Mai | STM | User | "Run tests before commit" |
| **decision** | Mai | LTM (auto) | Project | "Decided SQLite over Postgres" |
| **bugfix** | Mai | LTM (auto) | Project | "Fixed null pointer in auth" |
| **semantic** | Mai | STM | Project | "API uses REST, not GraphQL" |
| **episodic** | Sì (7gg) | STM | Project | "Yesterday we refactored auth" |

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

## Debug

```bash
# Visualizzare log
tail -f ~/.true-memory/plugin-debug.log

# Query database (quando funzionante)
sqlite3 ~/.true-memory/memory.db ".schema"

# Cercare errori
grep -i "error" ~/.true-memory/plugin-debug.log
```

---

## Git Workflow

**REGOLA**: Commit sempre e solo in locale. Push SOLO quando il plugin è testato e funzionante.

**Commit attuali**: 6 locali (non pushati)

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Codice di riferimento
- [PsychMem locale](~/Documents/_PROGETTI/psychmem) - Per copia file e PR bun build fix
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin funzionante di riferimento

---

## Notes

- **Creato**: 22/02/2026
- **Ispirato da**: [PsychMem](https://github.com/muratg98/psychmem) v1.0.5
- **Miglioramenti**: Basati su feedback Reddit r/opencodeCLI
- **Bug risolto**: esbuild → bun build fix
- **Stato**: FASE 1 completata, plugin funzionante
