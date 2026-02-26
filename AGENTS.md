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

**Aggiornamento**: 26/02/2026 - v1.0.10 - Toast + npm auth fix

### Stato Implementazione

| Componente | Status |
|------------|--------|
| Build (bun) | OK - 101.36 KB |
| TypeCheck | OK - 0 errors |
| Runtime | OK - Funzionante |
| npm | Pubblicato 1.0.10 |
| GitHub Actions | OK - NPM_TOKEN secret |
| Toast | OK - Tutte le sessioni |

### Bug Risolti

| Bug | Soluzione |
|-----|-----------|
| esbuild crash | bun build |
| QUEUED state | Opzione B + maintenance a session.end |
| Duplicate memories | content_hash + global debounce 2s |
| AI meta-talk | Pattern filtering (pipes, markdown tables) |
| Preference false positives | Question detection + list selection + sentence-level scoring |
| 1st person recall | FIRST_PERSON_RECALL_PATTERNS (10 lingue) |
| "Ricordami" ambiguity | REMIND_RECALL_PATTERNS (10 lingue) |
| Global scope retrieval | Query SQL allineata |
| Query consistency | vectorSearch = getMemoriesByScope |
| Explicit intent scope | Default PROJECT, keyword per GLOBAL |
| npm OIDC auth fallita | NPM_TOKEN come GitHub Secret |
| Toast solo nuove sessioni | Toast nel corpo plugin (tutte le sessioni) |
| Versione "unknown" | findPackageJsonUp() come OMO-slim |

---

## Project Overview

**True-Mem** - Plugin memoria persistente per OpenCode, ispirato a [PsychMem](https://github.com/muratg98/psychmem) con miglioramenti:
- Init non-bloccante (fire-and-forget)
- Decay solo episodic (preferenze permanenti)
- Jaccard similarity (no embeddings pesanti)
- Four-layer defense contro false positives
- Top-k retrieval contestuale

---

## Architettura

```
src/
├── index.ts              # Entry point, fire-and-forget init
├── storage/
│   ├── sqlite-adapter.ts # bun:sqlite + node:sqlite
│   └── database.ts       # MemoryDatabase class
├── memory/
│   ├── patterns.ts       # Multilingual keywords (15 lingue)
│   ├── negative-patterns.ts # False positive prevention
│   ├── classifier.ts     # Four-layer defense
│   ├── embeddings.ts     # Jaccard similarity
│   └── reconsolidate.ts  # Conflict resolution
├── extraction/queue.ts   # Async extraction
└── adapters/opencode/    # OpenCode hooks
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
| bugfix | Mai | Project | "Fixato auth timeout" |
| semantic | Mai | Project | "API usa REST" |
| episodic | Si (7gg) | Project | "Ieri abbiamo refactorato" |

---

## Scope Logic (Explicit Intent)

**Regola**: "Ricordami..." → default **PROJECT scope**

Per memorizzare in **GLOBAL scope**, il testo deve contenere una keyword globale:

| Lingua | Keywords |
|--------|----------|
| English | always, everywhere, for all projects, globally |
| Italian | sempre, ovunque, per tutti i progetti, globalmente |
| Spanish | siempre, en todas partes, para todos los proyectos |
| French | toujours, partout, pour tous les projets |
| German | immer, überall, für alle projekte |
| Portuguese | sempre, em todos os projetos |
| + Dutch, Turkish, Polish | altijd, her zaman, zawsze... |

**Esempi:**
- "Ricordami che uso bun" → **Project scope** (default)
- "Ricordami **sempre** che uso bun" → **Global scope** (keyword presente)
- "Remember to **always** run tests" → **Global scope** (keyword presente)

**File**: `src/memory/patterns.ts` → `GLOBAL_SCOPE_KEYWORDS` + `hasGlobalScopeKeyword()`

---

## Four-Layer Defense (False Positive Prevention)

1. **Question Detection** - Filtra domande (finiscono con ?)
2. **Negative Patterns** - AI meta-talk, list selection, 1st person recall, remind recall (10 lingue)
3. **Multi-Keyword + Sentence-Level** - Richiede 2+ segnali nella stessa frase
4. **Confidence Threshold** - Salva solo se score >= 0.6

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

**Automazione**: Push su main con versione nuova → npm publish + GitHub Release automatici

### File
`.github/workflows/release.yml`

### Daily Workflow

```bash
# 1. Modifica codice
# 2. Commit
git add . && git commit -m "fix: descrizione"

# 3. Bump versione
npm version patch   # o minor / major

# 4. Push
git push origin main

# 5. GitHub Action fa tutto:
#    → Pubblica su npm
#    → Crea GitHub Release con tag v1.0.x
```

### Come verificare successo

| Dove | Cosa controllare |
|------|------------------|
| **GitHub Actions** | https://github.com/rizal72/true-mem/actions → verde = OK |
| **npm** | https://www.npmjs.com/package/true-mem → versione aggiornata |
| **GitHub Releases** | https://github.com/rizal72/true-mem/releases → nuova release |
| **Notifiche GitHub** | Email/Notifiche se watch abilitato |

### Autenticazione npm

**NPM_TOKEN come GitHub Secret** (non OIDC - non funziona):
1. Genera automation token su npmjs.com
2. Aggiungi come secret: `Settings → Secrets → Actions → NPM_TOKEN`
3. Il workflow usa `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`

---

## Toast Notification

Il toast appare **a tutte le sessioni** (nuove e continuate), 2s dopo l'avvio di OpenCode.

**Implementazione** (`src/index.ts`):
- Toast nel corpo del plugin (non su `session.created`)
- Delay 2s per far stabilizzare UI
- Versione letta con `findPackageJsonUp()` (come OMO-slim)

**Nota**: OpenCode TUI supporta solo UN toast alla volta (l'ultimo sovrascrive).

---

## Best Practice

- Background tasks: attendere notifica automatica, no polling
- Test pulizia: eseguire manualmente `rm -rf ~/.true-mem/`
- No emoji nel codice

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem)
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin riferimento
