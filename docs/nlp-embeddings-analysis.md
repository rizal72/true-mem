# NLP Embeddings Analysis - Oracle Strategic Review

**Date:** March 5, 2026
**Status:** Research - Not for Release
**Decision:** Stay with Jaccard for v1.x

---

## Executive Summary

**Recommendation: STAY WITH JACCARD for True-Mem v1.x**

The embedding landscape hasn't matured enough for TUI plugins yet. The crash risk outweighs the semantic benefit.

---

## Critical Findings

### 1. Transformers.js v3+ Is NOT Production-Ready for TUI

**Deal-breakers identified:**

| Issue | Details |
|-------|---------|
| Memory leaks | Issue #1491 (Feb 2026): Memory accumulates even with explicit cleanup |
| macOS crashes | Issue #1242: 10GB+ memory usage, eventual crash |
| No automatic cleanup | Requires explicit dispose() + signal handlers |
| Worker isolation complexity | Need worker management, memory monitoring, graceful shutdown, fallback logic |

**Fundamental problem:** Transformers.js wasn't designed for long-running TUI processes. It's optimized for web apps (short-lived browser sessions) where memory leaks are masked by page refreshes.

### 2. FastEmbed-js Is Dead

Archived January 15, 2026 - completely off the table.

### 3. Model Choice (If You Proceed)

**Only viable option:** `all-MiniLM-L6-v2`

| Metric | Value |
|--------|-------|
| Footprint | 43MB (acceptable) |
| License | Apache 2.0 (commercial OK) |
| Dimensions | 384 (manageable) |
| Use case | Proven for technical text |

**Why NOT Jina v5:**
- 456MB footprint (10x larger, violates "lightweight" principle)
- CC-BY-NC 4.0 license (non-commercial - kills it)
- Overkill for coding context use case

---

## Strategic Decision Matrix

| Factor | Jaccard (Current) | Transformers.js v3 |
|--------|-------------------|-------------------|
| Bundle Size | 110KB | +43MB model |
| Crash Risk | Zero | High (confirmed) |
| Latency | Instant | 50-100ms first, 10-20ms subsequent |
| Maintenance | Low | High (cleanup, workers) |
| Semantic Quality | Keyword-only | True semantic |
| User Trust | Stable | Risky |
| Implementation | Done | Complex |

---

## Three-Phase Strategy

### Phase 1: STABILIZE (Current - v1.x)
**Status:** Execute immediately

Actions:
1. Stay with Jaccard only
2. Focus on stability
3. Enhance Jaccard if needed (Italian keyword expansion, etc.)

### Phase 2: MONITOR (6-12 months)
**Status:** Wait and watch

Actions:
1. Monitor Transformers.js v4 development
2. Watch for memory management improvements
3. Collect user feedback on semantic search needs

### Phase 3: EXPERIMENT (When v4 stabilizes)
**Status:** Future consideration

Actions:
1. Experiment in separate branch with worker isolation
2. Keep Jaccard as always-on fallback
3. Only release if 100% stable

---

## Experimental Branch Plan (For Local Testing Only)

**Purpose:** Test NLP embeddings locally without affecting main/v1.x

**Architecture:**

```
┌─────────────────────────────────────┐
│  Main Thread (TUI Plugin)           │
│  - Memory retrieval                 │
│  - Fallback: Jaccard (always)        │
│  - Feature flag: TRUE_MEM_EMBEDDINGS│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Worker Thread (Isolated)           │
│  - Singleton model (all-MiniLM)     │
│  - Memory monitoring (500MB cap)    │
│  - Graceful shutdown on SIGTERM   │
│  - Auto-disable on OOM/crash        │
└─────────────────────────────────────┘
```

**Requirements for v2.x experiment:**

1. **Worker thread isolation** - Never block TUI main thread
2. **Explicit dispose() + signal handlers** - Proper cleanup
3. **Memory monitoring with auto-disable** - Kill worker if >500MB
4. **Circuit breaker** - Disable after 3 failures in 5 min
5. **Feature flag** - Environment variable to enable/disable
6. **Always-on Jaccard fallback** - Never break existing functionality
7. **Separate branch** - Never merge to main until 100% stable

**Success Criteria Before Merging:**

| Criterion | Target |
|-----------|--------|
| Zero crashes | 100 hours TUI testing |
| Memory stable | <150MB total (plugin + model) |
| Cold start | <3 seconds |
| Warm queries | <100ms |
| Fallback works | When embeddings fail |
| Feature flag | Instant disable possible |
| Bundle size | <50MB total |
| License | Apache 2.0 or MIT only |

**If ANY criterion fails:** Stay with Jaccard, do not merge.

---

## Why This Decision

**Critical insight from memories:**
> "da ora in poi c'è gente che usa true-mem"

This changes everything:
- Can't experiment on production users
- One crash = lost trust in memory system
- Memory systems are fragile - users stop using them if unreliable
- "Good enough and stable" beats "perfect and crashy"

**The PsychMem lesson:**
- PsychMem works because it's simple and reliable
- Adding complexity for marginal semantic gain is risky

---

## User Communication

If users ask about semantic search:

> "True-Mem uses keyword matching (Jaccard similarity) for memory retrieval. This approach is instant, reliable, and works well for coding context where technical terms are consistent. We're monitoring embedding technology and may add optional semantic search in the future once it's stable enough for production TUI environments."

---

## Next Steps

1. Document this decision in AGENTS.md
2. Close this research thread
3. Focus on v1.x stability improvements
4. Revisit in 6-12 months when Transformers.js v4 stabilizes

---

## References

- Transformers.js Issue #1242: macOS memory crashes
- Transformers.js Issue #1491: Memory leak patterns
- FastEmbed-js: Archived Jan 15, 2026
- Model comparison: all-MiniLM-L6-v2 (43MB) vs Jina v5 (456MB)

---

## Implementation Log (March 2026)

**Status:** Experimental branch `NLP` - Working locally

### What Was Implemented

1. **EmbeddingService** (`src/memory/embeddings-nlp.ts`)
   - Singleton pattern for worker management
   - Circuit breaker (3 failures / 5 min)
   - Race condition fix (promise before worker spawn)
   - Path resolution from package root

2. **Worker Thread** (`src/memory/embedding-worker.ts`)
   - Transformers.js v4 with `eval('import()')` hack for bundling
   - Model: all-MiniLM-L6-v2 (q8 quantized)
   - Memory monitoring (500MB cap)
   - Graceful shutdown with dispose()
   - Interval cleanup to prevent leaks

3. **Hybrid Similarity** (`src/memory/embeddings.ts`)
   - Jaccard fast path (>0.7)
   - Blending: 30% Jaccard + 70% Cosine
   - Fallback to Jaccard if embeddings fail
   - Detailed logging for tracking

4. **Integration** (`src/storage/database.ts`)
   - **CRITICAL FIX:** vectorSearch now uses getSimilarity() instead of jaccardSimilarity()
   - Async/Promise.all for batch similarity calculation
   - Embeddings now actually used in retrieval!

### Issues Found & Fixed

| Issue | File | Fix |
|-------|------|-----|
| Race condition | embeddings-nlp.ts | Create promise before worker spawn |
| Path resolution | embeddings-nlp.ts | Walk up to package root |
| Bundling crash | embedding-worker.ts | Use eval('import()') for Transformers.js |
| env undefined | embedding-worker.ts | Configure after loading |
| Handler leak | embeddings-nlp.ts | Remove handler on timeout |
| Interval leak | embedding-worker.ts | clearInterval() in SIGTERM |
| TUI pollution | embedding-worker.ts | Send logs to parent instead of stdout |
| **Not used in retrieval!** | database.ts | Replace jaccardSimilarity with getSimilarity |

### Test Results

**Successful initialization:**
```
[embedding-worker] Loading Transformers.js...
[embedding-worker] Transformers.js configured, cacheDir: ~/.true-mem/models
[embedding-worker] Transformers.js loaded, initializing model: Xenova/all-MiniLM-L6-v2
[embedding-worker] Model loaded successfully
Embedding worker ready
NLP embeddings initialized successfully
```

### Known Limitations

- Cold start: 2-3s (model download first time)
- Worker bundle: 2.56 KB (loads Transformers.js dynamically)
- No semantic classification (only retrieval)
- Not production-ready (experimental branch)

### Next Steps

1. **Oracle review** - Verify complete workflow
2. **Extended testing** - 100 hours TUI usage
3. **Performance benchmarks** - Latency, memory, accuracy
4. **Decision** - Merge to main or keep separate
