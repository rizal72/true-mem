# Changelog

All notable changes to True-Mem will be documented in this file.

## [1.2.0-rc.0] - 2026-03-06

### Hot-Reload Resilience

**Fixed:**
- Node.js worker path persistence survives hot-reload (#34ecbd3)
- Debounce init (1s) prevents worker spawn thrashing (#56152e0)
- Promise leak fix - orphan promises resolved correctly (#2a311fa)
- Log rotation (1MB, 1 backup) prevents unbounded growth
- Cleanup race condition fixed (worker ref before null)

**Performance:**
- Reduced debounce from 2s to 1s for faster worker init

**Code Quality:**
- @oracle code review passed - production ready
- 0 HIGH issues, 3 MEDIUM (non-blocking), 3 LOW

**Technical Details:**
- `getEmbeddingsEnabled()` - Feature flag with config persistence
- `getNodePath()` - Node.js binary path with hot-reload support
- `initialize()` - Debounce wrapper with promise management
- `_doInitialize()` - Worker spawn logic
- Log rotation on every write, atomic rename

## [1.2.0-rc.0] - 2026-03-05

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
