# True-Mem - AGENTS.md

## CRITICAL CONFIG

```
PROJECTS_ROOT = ~/Documents/_PROGETTI/
THIS_PROJECT  = ~/Documents/_PROGETTI/true-mem

DATABASE      = ~/.true-mem/memory.db
DEBUG_LOG     = ~/.true-mem/plugin-debug.log
OPENCODE_CFG  = ~/.config/opencode/opencode.jsonc
```

---

## CURRENT STATUS

**Aggiornamento**: 05/03/2026 - v1.2.0-rc.0 - Hot-reload resilience

### Stato Implementazione

| Componente | Status |
|------------|--------|
| Build (bun) | OK - 140.72 KB |
| TypeCheck | OK - 0 errors |
| Runtime | OK - Funzionante |
| npm | Pubblicato 1.1.1 (main), rc in develop |
| GitHub Actions | OK - NPM_TOKEN secret |
| Toast | OK - Tutte le sessioni |
| Meta-Command | OK - Previene loop infiniti |
| Hot-Reload | OK - Embeddings sopravvivono ai restart |

### Branch Attivi

| Branch | Scopo | Status |
|--------|-------|--------|
| `main` | Produzione (Jaccard only) | Stable v1.1.1 |
| `develop` | **Development** - Hybrid embeddings, hot-reload fixes | Testing locale |

**Branch `develop`:**
- Branch di sviluppo per nuove feature prima del merge in main
- Include: hybrid embeddings (opzionale), hot-reload resilience
- Architettura: Jaccard (sempre attivo) + Transformers.js v4 via Node.js worker (opzionale)
- Feature flag: `TRUE_MEM_EMBEDDINGS=1` (unset/disabled = Jaccard-only)
- **NON per rilascio diretto** - Solo test locali, merge in main per release

**Problemi Noti (develop branch):**
- ⚠️ Plugin restart durante elaborazione prompt (OpenCode behavior, non bloccante)
- ✅ Embeddings re-inizializzate correttamente dopo restart

---

## Project Overview

**True-Mem** - Plugin memoria persistente per OpenCode, ispirato a [PsychMem](https://github.com/muratg98/psychmem) con miglioramenti:
- Init non-bloccante (fire-and-forget)
- Decay solo episodic (preferenze permanenti)
- Hybrid similarity (Jaccard + embeddings opzionali)
- Four-layer defense contro false positives
- Hot-reload resilient feature flags

---

## Architettura

```
src/
├── index.ts              # Entry point, fire-and-forget init
├── config/
│   └── feature-flags.ts  # Hot-reload resilient feature flags
├── storage/
│   ├── sqlite-adapter.ts # bun:sqlite + node:sqlite
│   └── database.ts       # MemoryDatabase class
├── memory/
│   ├── patterns.ts       # Multilingual keywords (15 lingue)
│   ├── negative-patterns.ts # False positive prevention
│   ├── classifier.ts     # Four-layer defense
│   ├── embeddings.ts     # Hybrid similarity (Jaccard + cosine)
│   ├── embeddings-nlp.ts # EmbeddingService singleton
│   └── reconsolidate.ts  # Conflict resolution
├── extraction/queue.ts   # Async extraction
└── adapters/opencode/    # OpenCode hooks
```

---

## Embeddings Architecture

**Hybrid Bun+Node.js Solution:**

```
Main Thread (Bun)
├─ Plugin hooks (OpenCode API)
├─ Database (SQLite)
├─ Feature flags (hot-reload resilient)
└─ EmbeddingService (singleton)
     └─ Node.js child process worker
          ├─ Transformers.js v4
          ├─ all-MiniLM-L6-v2 (q8 quantized, 384 dims)
          └─ ONNX Runtime (stable)
```

**Safety Features:**
- Circuit breaker: 3 failures / 5 min
- Memory monitoring: 500MB cap
- Timeout: 5s per request
- Graceful degradation to Jaccard

**Hot-Reload Resilience:**
- Env var saved to `~/.true-mem/config.json`
- Config file used when env var undefined
- Requires OpenCode restart to change settings

**Feature Flag:**
```bash
export TRUE_MEM_EMBEDDINGS=1  # Enable embeddings
export TRUE_MEM_EMBEDDINGS=0  # Disable (default)
```

---

## Memory Injection

### Quando vengono iniettate le memorie?

**Hook:** `experimental.chat.system.transform`
- Chiamato **prima di ogni richiesta al modello**
- Inietta memorie in tempo reale nel system prompt

**Flusso:**
```
Utente scrive messaggio → OpenCode prepara richiesta → 
Hook transform eseguito → Memorie iniettate nel system → 
Richiesta inviata al modello con memorie incluse
```

### Selezione Memorie

**Strategia attuale:**
- `getMemoriesByScope(worktree, 20)` ordina per **strength DESC**
- Prende le 20 memorie con strength più alta
- **NON** per rilevanza semantica al contesto

**Configurazione limite:**
```bash
export TRUE_MEM_MAX_MEMORIES=20  # Default
export TRUE_MEM_MAX_MEMORIES=25  # Più contesto
export TRUE_MEM_MAX_MEMORIES=15  # Meno token
```

---

## Classificazioni Memorie

| Tipo | Decay | Scope | Esempio |
|------|-------|-------|---------|
| constraint | Mai | Global | "Never use var" |
| preference | Mai | Global | "Preferisco TypeScript" |
| learning | Mai | Global | "Imparato bun:sqlite" |
| procedural | Mai | Global | "Test prima di commit" |
| decision | Mai | Project | "Scelto SQLite" |
| semantic | Mai | Project | "API usa REST" |
| episodic | Si (7gg) | Project | "Ieri abbiamo refactorato" |

### Pre-filtraggio Contenuti

- **URL > 150 caratteri** - Skip (evita API dumps)
- **Contenuti > 500 caratteri** - Skip (evita clipboard accidentali)

---

## Scope Logic (Explicit Intent)

**Regola**: "Ricordami..." → default **PROJECT scope**

Per memorizzare in **GLOBAL scope**, il testo deve contenere keyword globale:
- English: always, everywhere, for all projects, globally
- Italian: sempre, ovunque, per tutti i progetti, globalmente
- + ES, FR, DE, PT, NL, PL, TR

**File:** `src/memory/patterns.ts` → `GLOBAL_SCOPE_KEYWORDS`

---

## Four-Layer Defense

1. **Question Detection** - Filtra domande (finiscono con ?)
2. **Negative Patterns** - AI meta-talk, list selection, 1st person recall (10 lingue)
3. **Multi-Keyword + Sentence-Level** - Richiede 2+ segnali nella stessa frase
4. **Confidence Threshold** - Salva solo se score >= 0.6

---

## Meta-Command Detection

**Problema:** Loop infinito quando si chiede di cancellare una memoria usando il suo pattern.

**Soluzione:** Pattern `MEMORY_COMMAND_PATTERNS` che rilevano comandi diretti al sistema memoria.

| Pattern | Azione |
|---------|--------|
| "cancelliamo questa memoria: ho capito X" | **BLOCK** |
| "ho imparato come cancellare file" | **ALLOW** |
| "ricordati di eliminare i log" | **ALLOW** |

**File:** `src/memory/negative-patterns.ts` - Supporto multilingue (9 lingue)

---

## Dipendenze

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.2.6",
    "@opencode-ai/sdk": "^1.2.6",
    "uuid": "^13.0.0"
  }
}
```

**CRITICAL:**
- Usare `bun build` (NON esbuild - crasha in OpenCode)
- SQLite built-in (bun:sqlite / node:sqlite)

---

## Debug

```bash
# Log
tail -f ~/.true-mem/plugin-debug.log

# Query memories
sqlite3 ~/.true-mem/memory.db "SELECT classification, substr(summary,1,50) FROM memory_units WHERE status='active';"

# Delete memory
sqlite3 ~/.true-mem/memory.db "UPDATE memory_units SET status='deleted' WHERE id='...';"
```

---

## Git & npm

- Commit solo locale (push su richiesta)
- npm publish solo con permesso esplicito
- Versione letta con `findPackageJsonUp()` (come OMO-slim)

---

## Release Workflow (GitHub Actions)

### REGOLA CRITICA

**PRIMA di pushare per un release:**

```bash
npm version patch -m "release: v%s - <FEATURE_NAME>"
npm version minor -m "release: v%s - <FEATURE_NAME>"
npm version major -m "release: v%s - <FEATURE_NAME>"
```

**Automazione:** Push su main con versione nuova → npm publish + GitHub Release automatici

---

## Best Practice

- Background tasks: attendere notifica automatica, no polling
- Test pulizia: eseguire manualmente `rm -rf ~/.true-mem/`
- No emoji nel codice

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem)
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin riferimento
- [CHANGELOG.md](./CHANGELOG.md) - Storico modifiche completo
