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

## ✅ CURRENT STATUS - FASE 1-7 COMPLETATE + QUEUED PROBLEM RISOLTO

**Data ultimo aggiornamento**: 24/02/2026

### Stato Implementazione

| Componente | Status | Note |
|------------|--------|------|
| package.json | ✅ | Deps: @opencode-ai/plugin, @opencode-ai/sdk, uuid (Transformers.js rimosso) |
| tsconfig.json | ✅ | ESM, Node 22+, strict |
| src/logger.ts | ✅ | File-based, rotate 10MB |
| src/config.ts | ✅ | Default config completo |
| src/types.ts | ✅ | Types + SDK re-exports |
| src/storage/sqlite-adapter.ts | ✅ | bun:sqlite + node:sqlite |
| src/storage/database.ts | ✅ | MemoryDatabase class |
| src/memory/patterns.ts | ✅ | 670 lines, 15 languages |
| src/memory/negative-patterns.ts | ✅ | False positive prevention |
| src/memory/role-patterns.ts | ✅ | Role-aware extraction (Human vs Assistant) |
| src/memory/classifier.ts | ✅ | Four-layer defense + explicit intent + role validation |
| src/memory/embeddings.ts | ✅ | Jaccard similarity (Transformers.js rimosso) |
| src/memory/reconsolidate.ts | ✅ | Conflict resolution (no embeddings) |
| src/extraction/queue.ts | ✅ | Fire-and-forget extraction queue |
| src/adapters/opencode/index.ts | ✅ | Full extraction + atomic injection + maintenance moved to session.end |
| src/index.ts | ✅ | Opzione B: init immediato non-awaited |
| **Build** | ✅ | `dist/index.js` (92.19 KB) - **BUN BUILD (no lazyInit)** |
| **TypeCheck** | ✅ | 0 errors |
| **Runtime Test** | ✅ | **FUNZIONA** |
| **Async Extraction** | ✅ | Fire-and-forget + 500ms debounce |
| **False Positive Prevention** | ✅ | Four-layer defense + explicit intent isolation + role validation |
| **Vector Embeddings** | ✅ | Jaccard similarity (Transformers.js rimosso) |
| **Intelligent Decay** | ✅ | Only episodic, triggered on session.end |
| **Reconsolidation** | ✅ | Conflict resolution (no embeddings) |
| **QUEUED Problem** | ✅ | **RISOLTO** - Opzione B + maintenance moved to session.end |

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

### 🟢 FIX: First-Prompt Injection Strategy

**Problema**: L'iniezione di memorie al session start poteva creare context bloat o recuperare memorie non pertinenti alla task corrente.

**Soluzione**: Implementare first-prompt injection con contextual vector search:
- Injection avviene SOLO dopo il primo prompt dell'utente in ogni session (nuova o continuata)
- Il testo del prompt dell'utente viene usato per generare embedding e fare vector search
- Recupera top-k memorie semanticamente correlate al task corrente
- In `handleMessageUpdated`: trigger injection quando `role === 'user'` e sessione non ancora iniettata
- Continuano le sessioni tracciate con `state.injectedSessions` Set per evitare iniezioni duplicate

**Implementazione**:
```typescript
// In handleMessageUpdated (src/adapters/opencode/index.ts):
const role = info?.role ?? (eventProps?.role as string | undefined);
if (role === 'user' && !state.injectedSessions.has(sessionId)) {
  state.injectedSessions.add(sessionId);

  // Extract user's message content for contextual retrieval
  let userQuery: string | undefined;
  const parts = info?.parts ?? (eventProps?.parts as Part[] | undefined);
  if (parts && parts.length > 0) {
    for (const part of parts) {
      if (part.type === 'text' && 'text' in part) {
        userQuery = (part as { text: string }).text;
        break;
      }
    }
  }

  const memories = await getRelevantMemories(state, limit, userQuery);
  // Inject memories...
}
```

Vedi `src/adapters/opencode/index.ts` per codice dettagliato.

### 🟢 FIX: QUEUED Problem - Opzione B + Maintenance Moved

**Problema**: Tutti i prompt andavano in stato QUEUED, bloccando l'interfaccia. Il problema era mascherato in PsychMem come "lentezza UI" (barra progressiva continuava per diversi secondi dopo risposta AI, ESC richiedeva più pressioni).

**Root Cause Analysis** (tramite @oracle e @explorer):
1. **PsychMem**: Default export awaited → blocca OpenCode startup
2. **True-Memory (vecchio)**: Lazy init con hooks awaited → primo hook bloccante
3. **Entrambi**: Decay e consolidation nel primo hook (`session.created`) → 20-100ms di overhead
4. **Colpevole principale**: `applyDecay()` + `runConsolidation()` scansionano TUTTE le memorie nel primo hook

**Soluzione**: Implementare Opzione B + spostare maintenance a session.end:
1. **Opzione B**: Rimuovere lazyInit, iniziare init immediatamente nel default export (non-awaited)
2. **Maintenance moved**: Spostare `applyDecay()` e `runConsolidation()` da `session.created` a `session.end`
3. **Strategia PsychMem**: Stesso approccio di PsychMem (maintenance alla fine, non all'inizio)

**Implementazione - Opzione B**:
```typescript
// In src/index.ts
const TrueMemory: Plugin = async (ctx) => {
  state.ctx = ctx;
  
  // Start initialization IMMEDIATELY but DON'T await
  state.initPromise = (async () => {
    log('Phase 1: Initializing plugin (lightweight)...');
    const { createTrueMemoryPlugin } = await import('./adapters/opencode/index.js');
    state.realHooks = await createTrueMemoryPlugin(state.ctx);
    state.initialized = true;
    log('Phase 1 complete - Plugin ready');
  })();
  
  // Return hooks IMMEDIATELY - no await
  return {
    'tool.execute.before': async (input, output) => {
      if (!state.initialized && state.initPromise) {
        await state.initPromise;  // < 50ms, impercettibile
      }
      if (state.realHooks?.['tool.execute.before']) {
        await state.realHooks['tool.execute.before'](input, output);
      }
    },
    // ... altri hooks
  };
};
```

**Implementazione - Maintenance Moved**:
```typescript
// In src/adapters/opencode/index.ts

// RIMOSSO da session.created
async function handleSessionCreated(...) {
  state.currentSessionId = sessionId;
  // ⚠️ RIMOSSO: applyDecay() + runConsolidation()
  state.db.createSession(sessionId, state.worktree, { agentType: 'opencode' });
}

// AGGIUNTO a session.end
async function handleSessionEnd(...) {
  // ✅ Maintenance qui (non blocca startup)
  try {
    const decayed = state.db.applyDecay();
    const promoted = state.db.runConsolidation();
    if (decayed > 0 || promoted > 0) {
      log(`Maintenance: decayed ${decayed} memories, promoted ${promoted} to LTM`);
    }
  } catch (err) {
    log(`Maintenance error: ${err}`);
  }
  
  state.db.endSession(effectiveSessionId, ...);
  state.currentSessionId = null;
}
```

**Risultati**:
- Tempo primo hook: 30-110ms → **8-20ms** (guadagno 22-90ms)
- QUEUED state: **RISOLTO**
- Startup OpenCode: Istantaneo (< 50ms)
- UI responsiveness: Non più blocchi

Vedi `src/index.ts` e `src/adapters/opencode/index.ts` per codice dettagliato.

### 🟢 FIX: Semantic Fallback for Explicit Intent

**Problema**: Frasi con intento esplicito ("Ricordati che...") ma senza keyword di classificazione specifiche venivano ignorate o mal classificate.

**Soluzione**: Implementare semantic fallback con alta confidence:
- Quando è rilevato `explicit_remember` ma nessuna classificazione raggiunge score ≥ 0.4
- Assegnare automaticamente classificazione `semantic` con confidence 0.85
- Questo garantisce che espliciti "ricorda questo" vengano sempre memorizzati
- L'alta confidence (0.85) riflette l'intento esplicito dell'utente

**Implementazione**:
```typescript
// In classifyWithExplicitIntent (src/memory/classifier.ts):
if (bestScore >= 0.4 && bestClassification) {
  const boostedConfidence = Math.max(0.85, bestScore);
  return { classification: bestClassification, confidence: boostedConfidence, isolatedContent };
}

// Semantic fallback for explicit intent
return {
  classification: 'semantic',
  confidence: 0.85,
  isolatedContent
};
```

Vedi `src/memory/classifier.ts` per codice dettagliato.

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
- `constraint`: 'non posso', 'vietato', 'proibito', 'obbligatorio'
- `preference`: 'preferisco', 'mi piace', 'voglio', 'prediligo', 'meglio', 'ottimo', 'invece', 'rispetto a'
- `decision`: 'deciso', 'scelto', 'selezionato', 'perché', 'poiché', 'motivo', 'ragione'
- `learning`: 'imparato', 'scoperto', 'capito', 'oggi', 'appena'
- `bugfix`: 'errore', 'guasto', 'fallimento', 'risolto', 'corretto', 'sistemato', 'patchato'
- `procedural': 'passo', 'processo', 'workflow', 'procedure', 'instructions', 'guide'

**Aggiunta Italian Explicit Intent Patterns**: Espansione dei pattern di intento esplicito per supportare italiano completo:
- `ricorda questo`, `ricordati che`, `ricorda che`
- `memorizza questo`, `memorizza che`, `memorizziamo`
- `ricordiamoci che`, `ricordiamoci di`, `tieni a mente`
- `nota che`, `tieni presente`

Vedi `PLAN.md` per codice dettagliato.

### 🟢 FIX: Role-Aware Extraction

**Problema**: Il sistema mescolava i messaggi Human e Assistant, causando falsi positivi da liste generate dall'Assistant e perdita di intento umano.

**Soluzione**: Implementare role-aware extraction in `src/memory/classifier.ts` e `src/memory/role-patterns.ts`:
- **Human messages**: Ricevono un weight multiplier di 10x per i segnali di intento
- **Role Validation**: Le classificazioni `preference`, `constraint`, `decision`, e `learning` DEVONO provenire da messaggi Human
- **Assistant Context**: I messaggi Assistant forniscono contesto ma non sono fonti primarie per preferenze/decisioni
- **Fourth Layer**: Role validation aggiunto come quarto livello di difesa contro falsi positivi

**Implementazione**:
```typescript
// src/types.ts
export const HUMAN_MESSAGE_WEIGHT_MULTIPLIER = 10;

export const ROLE_VALIDATION_RULES: Record<string, { validRoles: MessageRole[]; requiresPrimary: boolean }> = {
  constraint: { validRoles: ['user'], requiresPrimary: true },
  preference: { validRoles: ['user'], requiresPrimary: true },
  learning: { validRoles: ['user'], requiresPrimary: true },
  procedural: { validRoles: ['user'], requiresPrimary: true },
  decision: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  bugfix: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  semantic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  episodic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
};

// src/memory/role-patterns.ts
export function scoreHumanIntent(text: string): number {
  // Scores first-person expressions of preferences, decisions, constraints
  // Returns 0-1 score, higher = more likely Human intent
}

export function hasAssistantListPattern(text: string): boolean {
  // Detects Assistant rephrasings of user preferences as lists
  // These are down-weighted to prevent false positives
}
```

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

**Problema**: Transformers.js pipeline rimaneva caricato indefinitamente, causando crash di Bun e alto utilizzo CPU dopo sessioni prolungate (~70% CPU, ~150MB RAM leak).

**Soluzione**: Implementare ShutdownManager e idle timeout per proper cleanup:
- 5-minute idle timeout per il embedding pipeline
- Auto-dispose quando non usato per 5+ minuti
- Lazy reload al prossimo `embed()` call
- Graceful shutdown con `ShutdownManager` per chiudere database e risorse

**Implementazione**:
```typescript
// src/shutdown.ts - ShutdownManager per graceful resource cleanup
class ShutdownManager {
  private static instance: ShutdownManager;
  private handlers: ShutdownHandler[] = [];

  public registerHandler(name: string, handler: () => void | Promise<void>): void {
    this.handlers.push({ name, handler });
  }

  public async executeShutdown(reason: string): Promise<void> {
    const reversedHandlers = [...this.handlers].reverse();
    for (const { name, handler } of reversedHandlers) {
      log(`Executing shutdown handler: ${name}`);
      await handler();
    }
  }
}

// src/memory/embeddings.ts - Idle timeout per embedding pipeline
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

**Handler Registration** (in `src/adapters/opencode/index.ts`):
```typescript
// Register database shutdown handler
registerShutdownHandler('database', () => db.close());

// Trigger graceful shutdown on server disposal
case 'server.instance.disposed':
  await executeShutdown('server.instance.disposed');
  break;
```

Vedi `src/shutdown.ts` e `src/memory/embeddings.ts` per codice dettagliato.

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
6. **False Positive Prevention** - Four-layer defense (negative patterns + multi-keyword + threshold + role validation)
   - **Layer 1**: Negative patterns (filtra falsi positivi noti)
   - **Layer 2**: Multi-keyword scoring (richiede 2+ segnali)
   - **Layer 3**: Confidence threshold (salva solo se score ≥ 0.6)
   - **Layer 4**: Role validation (Human-only per preferenze, decisioni, constraint)

---

## Technical Implementation Details

### 7-Feature Scoring Model

Le memorie vengono classificate e punteggiate usando 7 feature:

| Feature | Weight | Description | Formula |
|---------|--------|-------------|----------|
| **Recency** | 0.20 | Tempo dalla creazione (0 = recente, 1 = vecchio) | `1 - min(1, hours / 168)` |
| **Frequency** | 0.15 | Numero di accessi (log scale) | `min(1, log(freq + 1) / log(10))` |
| **Importance** | 0.25 | Combinazione di segnali (diminishing returns) | Σ(weight × 0.7^i) |
| **Utility** | 0.20 | Utilità per task corrente (feedback-adjusted) | Default 0.5 |
| **Novelty** | 0.10 | Distanza da memorie esistenti | `1 - maxSimilarity` |
| **Confidence** | 0.10 | Consenso evidenze per metodo estrazione | 0.50-0.75 |
| **Interference** | -0.10 | Penalità conflitti (solo se sim 0.3-0.8) | Similarity × 0.5 |

**Strength Formula**:
```
Strength = Σ(wᵢ × fᵢ) clamped to [0, 1]
```

### 3-Stage Extraction Pipeline

**Stage 1: Context Sweep**
1. **Multilingual Pattern Matching** (15 languages, 8 signal types)
2. **Structural Analysis** (typography, repetition, elaboration)
3. **Candidate Extraction** (pre-filtering for low-signal messages)

**Stage 2: Selective Memory**
1. **Feature Scoring** (7-feature vector calculation)
2. **Strength Calculation** (weighted sum)
3. **Store Allocation** (STM vs LTM based on classification)

### False Positive Prevention: Four-Layer Defense

**Layer 1: Negative Patterns** (Filter OUT known false positives)
```typescript
// Esempi di pattern negativi
/resolve\s+(dns|ip|address|hostname|url|uri)/i,  // Non "fix"
/fixed\s+(width|height|position|size)/i,           // CSS styling
/handle\s+(click|event|input|change)/i,            // Event handlers
/machine\s+learning/i,                             // Non "I learned"
```

**Layer 2: Multi-Keyword Scoring** (Require 2+ signals)
```typescript
// Need at least 1 primary + 1 booster for high confidence
if (primaryMatches === 0) return 0;          // No primary keyword
if (primaryMatches === 1 && boosterMatches === 0) return 0.4;  // Low confidence

return Math.min(1, 0.4 + (primaryMatches * 0.2) + (boosterMatches * 0.15));
```

**Layer 3: Confidence Threshold** (Store only if score ≥ 0.6)
```typescript
const CONFIDENCE_THRESHOLD = 0.6;
const finalScore = (baseScore + keywordScore) / 2;
return finalScore >= CONFIDENCE_THRESHOLD;
```

**Layer 4: Role Validation** (Human-only for user-level classifications)
| Classification | Valid Roles | Requires Human Primary? |
|----------------|--------------|------------------------|
| constraint | user | ✅ YES |
| preference | user | ✅ YES |
| learning | user | ✅ YES |
| procedural | user | ✅ YES |
| decision | user, assistant | ❌ NO |
| bugfix | user, assistant | ❌ NO |
| semantic | user, assistant | ❌ NO |
| episodic | user, assistant | ❌ NO |

**Human Message Weight Multiplier**: 10x for intent signals

### Multilingual Classification (Italian Support)

**Pattern di intento esplicito in italiano**:
- `ricorda questo` → Remember this
- `ricordati che` / `ricorda che` → Remember that
- `memorizza questo` / `memorizza che` → Memorize this/that
- `ricordiamoci che` / `ricordiamoci di` → Let's remember that/to
- `tieni a mente` / `keep in mind` → Keep in mind
- `nota che` / `note that` → Note that

**Keyword italiane per categoria**:
```typescript
constraint: ['non posso', 'vietato', 'proibito', 'obbligatorio', 'evita']
preference: ['preferisco', 'mi piace', 'voglio', 'prediligo', 'meglio', 'ottimo', 'invece', 'rispetto a']
decision: ['deciso', 'scelto', 'selezionato', 'abbiamo deciso', 'perché', 'poiché', 'motivo', 'ragione']
learning: ['imparato', 'scoperto', 'capito', 'oggi', 'appena']
bugfix: ['errore', 'guasto', 'fallimento', 'risolto', 'corretto', 'sistemato', 'patchato']
procedural: ['passo', 'processo', 'workflow', 'procedura', 'instructions', 'guide']
```

### Store Allocation Rules

| Classification | Default Store | Auto-Promote to LTM? | Scope |
|----------------|---------------|----------------------|-------|
| bugfix | LTM | ✅ YES | Project |
| learning | LTM | ✅ YES | User (Global) |
| decision | LTM | ✅ YES | Project |
| constraint | STM | ❌ NO | User (Global) |
| preference | STM | ❌ NO | User (Global) |
| procedural | STM | ❌ NO | User (Global) |
| semantic | STM | ❌ NO | Project |
| episodic | STM | ❌ NO | Project |

**Promotion conditions** (STM → LTM):
- `strength >= 0.7` (alta importanza)
- `frequency >= 3` (accesso/mention ripetuto)
- Classification è auto-promote (`bugfix`, `learning`, `decision`)

### Decay Strategy

**Applica decay SOLO a memorie episodiche**:
```typescript
if (config.applyDecayOnlyToEpisodic && memory.decay_type !== 'temporal') {
  return { strength: memory.strength, shouldRemove: false };  // No decay
}
```

**Esempi**:
- `episodic`: Decade con formula Ebbinghaus (λ = 0.05 per STM, 0.01 per LTM)
- `preference`, `constraint`, `decision`: Non decade mai (esplicito solo per conflitti)
- `learning`, `bugfix`, `semantic`, `procedural`: Non decade mai

### Vector Embeddings Configuration

**Modello**: `Xenova/all-MiniLM-L6-v2` (quantized)
- **Dimensioni**: 384
- **RAM**: ~43MB quando caricato
- **Inference**: ~50-100ms dopo primo caricamento
- **Storage**: BLOB in SQLite (Float32Array → Buffer)

**Architecture Decisions**:
| Aspect | Choice | Rationale |
|---------|--------|-----------|
| Library | `@huggingface/transformers` | Local, private, free - no API keys |
| Model | `Xenova/all-MiniLM-L6-v2` | Fast inference, good semantic quality |
| Storage | BLOB in SQLite | Float32Array → Buffer for storage |
| Retrieval | In-memory cosine similarity | SQLite lacks vector extensions |
| Optimization | Singleton + lazy loading + 5min idle timeout | Minimize memory footprint |

### Reconsolidation Strategy

**Vector-based conflict resolution** (non LLM):
```typescript
// Detect similar memories with embeddings
if (similarity > 0.7) {
  // Handle based on threshold ranges
  if (similarity > 0.9) return 'duplicate';    // Merge
  if (similarity > 0.8) return 'complement';   // Keep both
  return 'conflict';                          // Keep newer
}
```

**Azione**:
- `conflict` (> 0.7, ≤ 0.8): Mantieni la più recente
- `complement` (> 0.8, ≤ 0.9): Mantieni entrambe
- `duplicate` (> 0.9): Mergia (increment frequency)

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
│   │   ├── sqlite-adapter.ts    # bun:sqlite + node:sqlite runtime adapter
│   │   └── database.ts          # MemoryDatabase class with sessions/events/memory_units
│   ├── memory/
│   │   ├── patterns.ts          # Multilingual patterns (670 lines)
│   │   ├── negative-patterns.ts # False positive prevention
│   │   ├── role-patterns.ts    # Role-aware extraction (Human vs Assistant)
│   │   ├── classifier.ts        # Four-layer defense + role validation
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
- `schema_version` table - Version tracking (version, applied_at)
- `sessions` table - Session tracking (id, project, started_at, ended_at, status, metadata, transcript_path, transcript_watermark, message_watermark)
- `events` table - Raw hook events (id, session_id, hook_type, timestamp, content, tool_name, tool_input, tool_output, metadata)
- `memory_units` table - Complete memory model with all scoring features (id, session_id, store, classification, summary, source_event_ids, project_scope, timestamps, recency, frequency, importance, utility, novelty, confidence, interference, strength, decay_rate, tags, associations, status, version, embedding BLOB)
- Indici ottimizzati per retrieval veloce (scope, store, status, strength, classification, session)
- Supporto completo per vector embeddings (BLOB storage in memory_units)

**Rationale**: The complex three-table schema was chosen to maintain memory lineage and session context, providing better traceability of where and how each memory was extracted.

**Path database**: `~/.true-memory/memory.db`

---

## Debug

```bash
# Visualizzare log
tail -f ~/.true-memory/plugin-debug.log

# Query database schema
sqlite3 ~/.true-memory/memory.db ".schema"

# Query memories
sqlite3 ~/.true-memory/memory.db "SELECT classification, summary, strength FROM memory_units WHERE status = 'active' ORDER BY strength DESC LIMIT 10;"

# Cercare errori
grep -i "error" ~/.true-memory/plugin-debug.log
```

---

## Git Workflow

**REGOLA**: Commit sempre e solo in locale. Push SOLO quando il plugin è testato e funzionante.

**Commit attuali**: 6 locali (non pushati)

### Best Practice: Background Tasks

Quando si lancia un task in background (`background_task`), NON controllare lo stato ogni 5 secondi. Attendi la notifica automatica di completamento. Questo evita spreco di token e rumore nei log.

### Best Practice: Manual Cleanup for Testing

Durante la fase di test e sviluppo, è preferibile che l'utente esegua manualmente la pulizia delle directory persistenti (es. `rm -rf ~/.true-memory/`) invece di delegare il task all'AI. Questo permette di risparmiare token e garantisce un controllo totale sull'ambiente di test.

---

## Risorse

- [PsychMem repo](https://github.com/muratg98/psychmem) - Codice di riferimento
- [PsychMem locale](~/Documents/_PROGETTI/psychmem_fork/psychmem) - Per copia file e PR bun build fix
- [oh-my-opencode-slim](~/Documents/_PROGETTI/oh-my-opencode-slim) - Plugin funzionante di riferimento

---

## Confronto Tecnico: True-Memory vs PsychMem

**Premessa**: PsychMem ha aperto la strada alla memoria persistente per AI coding assistant. True-Memory è un'evoluzione architetturale basata sull'esperienza pratica.

**5 Aree di Miglioramento:**
- **Stabilità**: Init lazy e fire-and-forget per evitare blocchi all'avvio di OpenCode.
- **Build**: Bundle Bun-native stabile invece di esbuild (che causava crash).
- **Precisione**: Sistema di difesa a quattro livelli (negative patterns + multi-keyword + threshold + role validation) per ridurre i falsi positivi.
- **Role-Aware Extraction**: Distingue tra messaggi Human (10x weight) e Assistant per prevenire estrazioni da liste generate dall'AI.
- **Retrieval**: Vector embeddings (Transformers.js) e top-k contestuale invece di Jaccard similarity e iniezione globale.
- **Decay**: Decadimento intelligente solo per memorie episodiche; le preferenze e le decisioni rimangono permanenti.

---

## Notes

- **Creato**: 22/02/2026
- **Ispirato da**: [PsychMem](https://github.com/muratg98/psychmem) v1.0.5
- **Miglioramenti**: Basati su feedback Reddit r/opencodeCLI
- **Bug risolti**: esbuild → bun build fix, Transformers.js bundling, Memory Echo prevention, Explicit intent classification, Multilingual support, Multi-Agent noise detection, Resource leaks & crashes, Meta-talk filtering
- **Stato**: FASE 1-7 completate, plugin funzionante con vector embeddings attivi + production-ready stability fixes
