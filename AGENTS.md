# True-Mem - AGENTS.md

## CRITICAL CONFIG

```
PROJECTS_ROOT = ~/Documents/_PROGETTI/
THIS_PROJECT  = ~/Documents/_PROGETTI/true-mem

DATABASE      = ~/.true-mem/memory.db
DEBUG_LOG     = ~/.true-mem/plugin-debug.log
OPENCODE_CFG  = ~/.config/opencode/opencode.jsonc

# v1.3.0+ Config Files
CONFIG        = ~/.true-mem/config.jsonc    # User settings (JSONC with comments)
STATE         = ~/.true-mem/state.json      # Runtime state (auto-managed)
```

---

## CURRENT STATUS

**Aggiornamento**: 09/03/2026 - v1.3.2 - Default Injection Mode Changed

### Stato Implementazione

| Componente | Status |
|------------|--------|
| Build (bun) | ✅ OK - ~155 KB |
| TypeCheck | ✅ OK - 0 errors |
| Runtime | ✅ OK - Funzionante |
| npm | Pubblicato 1.3.1 (main), develop in sync |
| GitHub Actions | OK - NPM_TOKEN secret |
| Toast | OK - Tutte le sessioni |
| Meta-Command | OK - Previene loop infiniti |
| Hot-Reload | ✅ OK - Node.js path persistence + debounce (1s) |
| Log Rotation | ✅ OK - 1MB con 1 backup |
| Injection Mode | ✅ v1.3.2 - Default changed to 1 (ALWAYS) |
| Session Resume | ✅ Phase 2 - Detect resumed sessions |
| Sub-Agent Mode | ✅ Phase 3 - Configurable sub-agent injection |
| Config System | ✅ v1.3.0 - Separate config.json + state.json |
| Project Scope | ✅ v1.3.1 - Fixed memory leakage across projects |

---

## Project Overview

**True-Mem** - Plugin memoria persistente per OpenCode, ispirato a [PsychMem](https://github.com/muratg98/psychmem) con miglioramenti:
- Init non-bloccante (fire-and-forget)
- Decay solo episodic (preferenze permanenti)
- Hybrid similarity (Jaccard + embeddings opzionali)
- Four-layer defense contro false positives
- Hot-reload resilient feature flags

**Feature Flag (embeddings):**
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

### Injection Mode Configuration (v1.3.0)

| Mode | Value | Behavior | Token Savings |
|------|-------|----------|---------------|
| SESSION_START | 0 | Inject only at session start | ~76% |
| ALWAYS | 1 | Inject on every prompt (DEFAULT) | 0% |

**Environment Variables:**

- `TRUE_MEM_INJECTION_MODE` - 0=SESSION_START, 1=ALWAYS (default)
- `TRUE_MEM_SUBAGENT_MODE` - 0=DISABLED, 1=ENABLED (default)
- `TRUE_MEM_MAX_MEMORIES` - Default 20
- `TRUE_MEM_EMBEDDINGS` - 0=Jaccard only (default), 1=Hybrid

**v1.3.2**: Default changed to 1 (ALWAYS) - real-time memory updates
**Phase 1**: Mode 1 = inject every prompt, Mode 0 = inject once per session
**Phase 2**: Session resume detection - skips if context already present
**Phase 3**: Controls injection into task/background_task prompts

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

- `@opencode-ai/plugin` - OpenCode plugin SDK
- `@opencode-ai/sdk` - OpenCode SDK  
- `uuid` - UUID generation

**CRITICAL:**
- Build: `bun build` (NON esbuild - crasha in OpenCode)
- SQLite: built-in (bun:sqlite / node:sqlite)

---

## Debug

**Log:** `tail -f ~/.true-mem/plugin-debug.log`

**Query memories**
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
