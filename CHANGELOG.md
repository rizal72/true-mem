# Changelog

All notable changes to True-Mem will be documented in this file.

## [1.3.1] - 2026-03-08

### Fixed - Project Scope Memory Leakage
- **Critical Bug**: Project-scoped memories were leaking across projects
- Root cause: Worktree cache had priority over ctx.worktree when switching projects
- Fix #1: Inverted cache priority - ctx > directory > cache (fallback)
- Fix #2: Safe fallback query returns only global memories when project undetermined
- Fix #3: Added cache invalidation logging for debugging
- Fix #4: Runtime worktree validation in transform hook for mid-session changes

### Technical
- `src/adapters/opencode/index.ts` - Worktree resolution logic rewritten
- `src/storage/database.ts` - Fallback query now filters by `project_scope IS NULL`
- Oracle code review: APPROVED with 85% confidence

## [1.3.0] - 2026-03-07

### Added
- **Phase 1: Injection Mode Configuration**
  - TRUE_MEM_INJECTION_MODE env var (0=SESSION_START, 1=ALWAYS)
  - ~76% token savings with default mode
  
- **Phase 2: Session Resume Detection**
  - Detects resumed sessions (opencode -c)
  - Prevents duplicate memory injection
  
- **Phase 3: Sub-Agent Optimization**
  - TRUE_MEM_SUBAGENT_MODE config (0=DISABLED, 1=ENABLED)
  - Skip injection in task/background_task when disabled

- **JSONC Configuration System**
  - Config file with comments: `~/.true-mem/config.jsonc`
  - Numeric values (0/1) instead of booleans
  - Template with inline explanations
  - Auto-creation on first run

- **Config/State Separation**
  - `config.jsonc` - User settings (injectionMode, subagentMode, embeddingsEnabled, maxMemories)
  - `state.json` - Runtime state (nodePath, lastEnvCheck)
  - Simplified migration: cleanup old config.json, create new files with defaults

### Fixed
- Race condition in session injection (Oracle review)
- API timeout protection (3s)
- Performance: limit message iteration to 10
- Improved tag detection with regex

### Technical
- New injection-tracker.ts module
- Updated experimental.chat.system.transform hook
- Updated tool.execute.before hook
- Build: 147.89KB, 0 TypeScript errors

## [1.2.0] - 2026-03-07

### Added - Hot-Reload Resilience

**Feature Flags Persistence** (`src/config/feature-flags.ts`)
- Added `getEmbeddingsEnabled()` with hot-reload resilience
- Environment variable → config file → false (default) priority chain
- Saves env var to `~/.true-mem/config.json` on first read
- Reads from config file when env var undefined (hot-reload scenario)
- Handles env var changes correctly (requires OpenCode restart)

### Fixed - Stability

**Circuit Breaker Reset** (`src/memory/embeddings-nlp.ts`)
- Reset `failureCount` and `lastFailure` in `initialize()` before circuit breaker check
- Allows re-initialization after plugin crash/hot-reload
- Prevents stuck "circuit breaker open" state across reloads

**Worker Killed Guard** (`src/memory/embeddings-nlp.ts`)
- Added check for `worker.killed` before sending messages
- Wrap `worker.send()` in try-catch to prevent crash propagation
- Graceful fallback to null on dead worker

**Hot-Reload State Reset** (`src/index.ts`)
- Detect hot-reload (state.initialized || state.initializingLock)
- Reset state for clean re-initialization
- Prevents lock blocking after plugin reload

**Diagnostic Logging**
- Improved worker exit logs: `Worker EXIT: code=${code}, signal=${signal}, killed=${killed}`
- Improved worker error logs: `Worker ERROR: ${message}, stack: ${stack}`
- Feature flag logging shows source (env/config/default)

### Architecture - Node.js Worker Solution

**Hybrid Bun+Node.js Architecture**
- Main plugin runs on Bun (fast bundling)
- Embeddings worker uses Node.js child process (ONNX Runtime stable)
- Avoids Bun panic crash with Transformers.js v4

**Worker Communication**
- IPC via `child_process.spawn()` with JSON messages
- Same message format as Bun Worker
- Graceful shutdown via IPC message + timeout

**Safety Features**
- Circuit breaker: 3 failures / 5 minutes
- Memory monitoring: 500MB cap
- Timeout: 5s per embedding request
- Graceful degradation to Jaccard

### Known Issues

**Plugin Restarts During Prompt Processing**
- OpenCode triggers hot-reload during model processing
- Root cause: OpenCode plugin system behavior (not Bun)
- Impact: Minor - embeddings re-initialize correctly after restart
- Frequency: Occasional (1-2 times per session)

## [1.1.1] - 2026-02-28

### Fixed

- Meta-command detection to prevent infinite loops
- Contextual scope detection for user-level memories
- Hybrid similarity consistency in reconsolidation

## [1.1.0] - 2026-02-27

### Added

- Meta-command patterns (9 languages)
- Contextual scope detection
- Dynamic memory selection with scope quotas
- Configurable memory limit via `TRUE_MEM_MAX_MEMORIES`

### Fixed

- Oracle review fixes (13 issues resolved)
- Scope logic fixes
- Marker patterns priority

## [1.0.0] - 2026-02-20

### Added

- Initial release
- Persistent memory storage (SQLite)
- Automatic memory extraction
- Four-layer defense against false positives
- Jaccard similarity for retrieval
- Multi-language support (15 languages)
- OpenCode plugin integration
