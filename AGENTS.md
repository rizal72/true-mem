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

**Aggiornamento**: 27/02/2026 - v1.1.0 - Remove bugfix classification

### Stato Implementazione

| Componente | Status |
|------------|--------|
| Build (bun) | OK - 110.17 KB |
| TypeCheck | OK - 0 errors |
| Runtime | OK - Funzionante |
| npm | Pubblicato 1.1.0 |
| GitHub Actions | OK - NPM_TOKEN secret |
| Toast | OK - Tutte le sessioni |

### Bug Risolti

| Bug | Soluzione |
|-----|-----------|
| bugfix classification noise | Removed classification + DB migration v3 |
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
| "ricordati sempre che" non matchava | markerPatterns con `(?:\s+\w+){0,5}?` |
| Negazioni memorizzate | NEGATION_PATTERNS (10 lingue) |
| lastExtractionTime race condition | Update solo quando extraction avviene |
| DB transaction async issue | vectorSearch fuori transazione |
| Watermark loop infinito | messagesProcessed logic |
| extractionSucceeded flag | Flag per trackare successo estrazione |
| getMemory null assertion | Null check + try-catch |
| vectorSearch consistency | Empty query skip con return [] |
| injectedSessions leak | Filter active sessions + reset |
| worktree fallback | Fallback a "/" invece di undefined |
| singleton state sync | Refactor per sincronizzare stato |
| markerPatterns ignorato | Check markerPatterns PRIMA del signal check |
| Global keyword in marker | `hasGlobalScopeKeyword(text)` invece di `isolatedContent` |

**Implementazione:**

```
Main Thread (TUI)
  ├─ Jaccard (sempre attivo, fallback)
  └─ EmbeddingService (opzionale)
       └─ Worker Thread (isolato)
            ├─ Transformers.js v4
            ├─ all-MiniLM-L6-v2 (q8 quantized)
            └─ Memory monitoring (500MB cap)
```

| Componente | File | Funzione |
|------------|------|----------|
| EmbeddingService | `src/memory/embeddings-nlp.ts` | Singleton con circuit breaker |
| Worker thread | `src/memory/embedding-worker.ts` | Isolamento Transformers.js |
| Hybrid similarity | `src/memory/embeddings.ts` | Jaccard + cosine blending |
| Init/Cleanup | `src/index.ts`, `src/adapters/opencode/index.ts` | Startup/shutdown handlers |

- **Modello:** `all-MiniLM-L6-v2` (q8 quantized, 384 dims, CPU only)
- **Safety:** Circuit breaker (3 fallimenti/5min), memory cap 500MB, timeout 5s, graceful degradation a Jaccard

**Come testare:**
```bash
git checkout NLP
export TRUE_MEM_EMBEDDINGS=1
bun run build
# Test in OpenCode, monitora crash e memoria
```

---

## Architecture Review (v1.0.12)

### Risolti (13/13)

**Oracle review** ha identificato 13 problemi. Risolti tutti (CRITICAL, HIGH, P1, P2):

| Priority | Issue | Fix |
|----------|-------|-----|
| **P0** | lastExtractionTime aggiornato in `canExtract()` | Spostato a fine `runExtraction()` |
| **P0** | DB transaction + async | `vectorSearch()` chiamata fuori transazione |
| **P1** | Watermark loop infinito | Logica `messagesProcessed` per skip messaggi già processati |
| **P1** | Nessun flag per successo estrazione | `extractionSucceeded` check prima di update |
| **P2** | `getMemory()` null assertion | Try-catch + return null |
| **P2** | `vectorSearch()` inconsistency | Empty query → return [] |
| **P2** | injectedSessions memory leak | Rimosso legacy code |
| **P2** | worktree undefined → crash | Fallback a `unknown-project-*` |
| **P2** | Singleton state sync | Refactor `initialize()` per return instance |
| **P3** | extractionQueue lifecycle | Aggiunto `resetExtractionQueue()` |
| **P4** | Versione hardcoded | `getVersion()` dinamico |
| **P5** | Legacy code cleanup | Rimosso `injectedSessions` |
| **P6** | markerPatterns ignorato | Check PRIMA del signal check |

### Rimanenti (0/13)

Tutti i problemi identificati da Oracle sono stati risolti.

---

## Scope Logic Fix (v1.0.14)

### Bug Risolti

| Bug | Soluzione |
|-----|-----------|
| markerPatterns ignorato | Check markerPatterns PRIMA del signal check in `classifyWithExplicitIntent()` |
| Global keyword in marker | `hasGlobalScopeKeyword(text)` controlla testo completo, non solo `isolatedContent` |

**Caso d'uso risolto:** "ricordati per sempre che X" → ora correttamente GLOBAL scope

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

## Embeddings: Storia Implementazione

### Originale: Vector Embeddings con Transformers.js

La prima implementazione usava **true semantic embeddings**:

| Componente | Dettaglio |
|------------|-----------|
| Libreria | `@huggingface/transformers` |
| Modello | `Xenova/all-MiniLM-L6-v2` (quantized) |
| RAM | ~43MB |
| Performance | Prima chiamata: 2-3s (model loading), successive: 50-100ms |
| Retrieval | Cosine similarity su vector a 384 dimensioni |

**Vantaggi:**
- True semantic search (sinonimi, concetti correlati)
- "error" matcha "exception", "bug" matcha "issue"

### Perché abbandonato

| Problema | Dettaglio |
|----------|-----------|
| **Bundling** | `bun build` bundleava male → richiedeva `eval('import(...)')` hack |
| **Crash all'uscita** | Transformers.js non si puliva correttamente → OpenCode crashava |
| **Complessità** | Dipendenza ML nativa, overhead di manutenzione |

### Soluzione attuale: Jaccard Similarity

Il file `src/memory/embeddings.ts` è diventato uno **stub**:
- `jaccardSimilarity(text1, text2)` → calcola overlap parole
- Tutte le funzioni vector restituiscono valori vuoti

**Trade-off:**
- No sinonimi ("error" ≠ "exception")
- Ma: zero dipendenze, zero crash, istantaneo
- Per coding assistant: sufficiente (termini tecnici consistenti)

### Possibile ripresa futura

Se Transformers.js risolve i problemi di cleanup:
1. Rimuovere lo stub da `embeddings.ts`
2. Ripristinare implementazione originale (vedere commit `b93bc50`)
3. Aggiornare `package.json` con dipendenza `@huggingface/transformers`

**Riferimento:** PLAN.md originale nel commit `d4325f0` contiene implementazione completa.

---

## Estrazione Memorie

**Trigger**: `session.idle` (quando l'utente smette di scrivere)

**Delays**:
1. **2 secondi** debounce globale tra estrazioni
2. **queueMicrotask()** per non bloccare UI

**Flusso**:
1. Utente invia messaggio → session diventa idle
2. Evento `session.idle` → job aggiunto alla queue
3. Check `canExtract()` → verifica 2s dall'ultima estrazione
4. Fetch nuovi messaggi dal watermark
5. Estrazione → salvataggio nel DB

**Schema DB**: colonna scope è `project_scope` (non `scope`)

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

### Pattern di Classificazione

**Episodic** - Riconoscimento automatico tramite marker temporali:
- **IT**: "ieri", "oggi", "abbiamo fatto", "siamo arrivati", "durante la call", "nel meeting"
- **EN**: "yesterday", "today", "we did", "we made", "during the session", "in the meeting"
- **Boosters**: "session", "call", "meeting", "just", "adesso"

**Priorità Classificazioni** (ordine di valutazione):
1. `episodic` - Eventi temporali specifici
2. `decision` - Scelte architetturali
3. `learning` - Scoperte permanenti (senza marker temporali)
4. `preference` - Preferenze utente
5. `constraint` - Vincoli assoluti
6. `procedural` - Workflow e procedure

**Nota**: Quando una frase contiene sia marker temporali ("ieri") che keyword di apprendimento ("ho imparato"), vince `episodic` perché l'evento è specifico nel tempo.

### Pre-filtraggio Contenuti

Prima della classificazione, il sistema filtra automaticamente:
- **URL > 150 caratteri** - Skip (evita API dumps, stack traces)
- **Contenuti > 500 caratteri** - Skip (evita clipboard accidentali)

Questo previene la memorizzazione di:
- Stack trace completi
- Output di log
- URL con query parameters lunghi
- Contenuti copiati accidentalmente

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

## Home Directory Behavior

Quando una sessione viene lanciata dalla **cartella home** (`~/`) o da una directory che non è un progetto git:

### Come viene determinato lo scope

```ts
// src/adapters/opencode/index.ts:127-129
const isValidPath = (path: string | undefined): boolean => {
  return !!(path && path !== '/' && path !== '\\' && path.trim().length > 0);
};

const worktree = isValidPath(ctx.worktree)
  ? ctx.worktree
  : (isValidPath(ctx.directory) ? ctx.directory : `unknown-project-${Date.now()}`);
```

La home (`/Users/riccardosallusti`) è un path **valido**, quindi viene usata come `worktree`.

### Risultato pratico

| Tipo memoria | Scope DB | Dove è visibile |
|--------------|----------|-----------------|
| preference, constraint, learning, procedural | `NULL` (Global) | **Ovunque** |
| decision, semantic, episodic | `/Users/riccardosallusti` (Project) | **Solo dalla home** |

### Comportamento attuale

True-Mem tratta la home come un **"progetto generico"**:
- Le memorie GLOBAL (preference, constraint, etc.) sono sempre visibili ovunque
- Le memorie PROJECT create dalla home restano **isolate** nella home
- Per rendere una memoria decision/semantic globale dalla home, usare keyword globali ("sempre", "ovunque")

### Possibili evoluzioni future

1. **Ignorare** memorie project-level quando non si è in un git repo
2. **Promuovere automaticamente** a global le memorie create dalla home
3. **Rilevare** se si è in `PROJECTS_ROOT` e usare scope diverso

**Stato attuale**: Comportamento intenzionalmente lasciato così (home = progetto generico)

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

### ⚠️ REGOLA CRITICA

**PRIMA di pushare per un release, fare SEMPRE bump versione con messaggio descrittivo:**

```bash
npm version patch -m "release: v%s - <FEATURE_NAME>"   # per bug fix
npm version minor -m "release: v%s - <FEATURE_NAME>"   # per nuove feature  
npm version major -m "release: v%s - <FEATURE_NAME>"   # per breaking changes
```

**Sostituire `<FEATURE_NAME>` con la feature/fix principale di quel release.**

**Esempi:**
- `npm version patch -m "release: v%s - list-memories command"`
- `npm version patch -m "release: v%s - fix circular import"`
- `npm version minor -m "release: v%s - multi-language support"`

Il workflow si attiva SOLO quando `package.json` cambia (versione nuova).

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

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem)
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin riferimento
