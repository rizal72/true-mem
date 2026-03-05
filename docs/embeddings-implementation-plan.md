# Embeddings Implementation Plan for True-Mem

**Date:** March 5, 2026
**Status:** Implementation Plan
**Target:** Make embeddings useful for memory injection

---

## 1. Executive Summary

### Problem Statement

True-Mem has optional NLP embeddings support (Transformers.js with all-MiniLM-L6-v2), but they are **not effectively used** for memory injection. The current implementation:

1. **Global injection** (`experimental.chat.system.transform`) uses `getMemoriesByScope()` which orders by **strength DESC**, not relevance
2. **Atomic injection** (`tool.execute.before`) uses `vectorSearch()` which uses hybrid similarity, but only for sub-agent tasks
3. **Context extraction** is missing - no query is extracted from conversation to drive semantic search

### Proposed Solution

Implement **context-aware memory retrieval** that:
1. Extracts conversation context from recent messages
2. Uses `vectorSearch()` with extracted context as query
3. Falls back gracefully to strength-based retrieval when embeddings fail
4. Selects more relevant memories while maintaining token efficiency

### Key Benefits

| Metric | Current | Proposed |
|--------|---------|----------|
| Memory selection | Strength-based (irrelevant) | Relevance-based (semantic) |
| Token cost | Fixed 20 memories (often irrelevant) | 20 highly relevant memories |
| Embeddings usage | Only in reconsolidation | Used for all injections |
| Fallback | None needed | Graceful to Jaccard/strength |

---

## 2. Current State Analysis

### 2.1 Memory Injection Flow

```
User sends message
       ↓
OpenCode prepares request
       ↓
experimental.chat.system.transform hook
       ↓
getMemoriesByScope(worktree, 20)  ← STRENGTH-BASED, NOT RELEVANT
       ↓
wrapMemories() → XML injection
       ↓
Request sent to model with memories
```

**Critical Issue:** `getMemoriesByScope()` at line 297 of `index.ts`:
```typescript
const allMemories = injectionState.db.getMemoriesByScope(state.worktree, 20);
```

This returns memories ordered by `strength DESC`, completely ignoring the **context** of the current conversation.

### 2.2 Available But Unused: vectorSearch()

The `vectorSearch()` method in `database.ts` (lines 642-681) already implements hybrid similarity:

```typescript
async vectorSearch(queryTextOrEmbedding: Float32Array | string, currentProject?: string, limit: number = 10): Promise<MemoryUnit[]>
```

**How it works:**
1. Fetches all active memories for current scope
2. Calculates hybrid similarity via `getSimilarity()` (30% Jaccard + 70% embeddings)
3. Sorts by similarity DESC
4. Returns top-k results

**But it's NOT used for global injection!** Only used in:
- `tool.execute.before` (atomic injection for sub-agents)
- `createMemory()` (reconsolidation conflict detection)

### 2.3 Hybrid Similarity Implementation

File: `src/memory/embeddings.ts` (lines 127-163)

```typescript
export async function getSimilarity(text1: string, text2: string): Promise<number> {
  // Fast path: Jaccard for exact keyword matches
  const jaccardScore = jaccardSimilarity(text1, text2);

  // If high confidence from Jaccard, return immediately
  if (jaccardScore > 0.7) {
    return jaccardScore;
  }

  // Semantic path: Use embeddings if available
  const embeddingService = EmbeddingService.getInstance();
  
  if (!embeddingService.isEnabled()) {
    return jaccardScore;  // Fallback: Jaccard only
  }

  // Blend: 30% Jaccard + 70% Cosine
  const blendedScore = (jaccardScore * 0.3) + (cosineScore * 0.7);
  return blendedScore;
}
```

**Key insight:** This already handles:
- Feature flag check (`TRUE_MEM_EMBEDDINGS=1`)
- Graceful fallback to Jaccard
- Fast path for high-confidence keyword matches

### 2.4 Feature Flag Architecture

```typescript
// embeddings-nlp.ts line 66
if (process.env.TRUE_MEM_EMBEDDINGS !== '1') {
  log('NLP embeddings disabled (TRUE_MEM_EMBEDDINGS not set to 1)');
  return false;
}
```

**Current behavior:**
- `TRUE_MEM_EMBEDDINGS=1` → Embeddings enabled
- `TRUE_MEM_EMBEDDINGS=0` or unset → Jaccard-only mode

**Requirement:** Implementation must work in BOTH modes.

---

## 3. Proposed Architecture Changes

### 3.1 Context Extraction Strategy

**Challenge:** How to extract query context from conversation?

**Options:**

| Strategy | Pros | Cons |
|----------|------|------|
| **A: Last N messages** | Simple, fast | May miss context from earlier |
| **B: Last user message only** | Most relevant | Too narrow |
| **C: Sliding window + keywords** | Balanced | More complex |
| **D: Hybrid (user + recent)** | Best coverage | Slightly more complex |

**Recommendation: Strategy D (Hybrid)**

```typescript
function extractQueryContext(messages: MessageContainer[], windowSize: number = 5): string {
  // 1. Get last N messages (both user and assistant)
  const recentMessages = messages.slice(-windowSize);
  
  // 2. Extract text from each message
  const contextParts: string[] = [];
  for (const msg of recentMessages) {
    for (const part of msg.parts) {
      if (part.type === 'text' && 'text' in part) {
        contextParts.push((part as { text: string }).text);
      }
    }
  }
  
  // 3. Join with separator (truncated to avoid token bloat)
  const fullContext = contextParts.join(' | ');
  
  // 4. Truncate to 500 chars (embeddings work best with focused queries)
  return fullContext.slice(-500);
}
```

**Why 500 chars?**
- Embedding models perform best with focused queries
- Prevents token bloat in similarity calculations
- Captures most recent, relevant context

### 3.2 Smart Memory Selection (Dynamic Strategy)

**Current:** Fixed 20 memories by strength (no scope distinction, no relevance)

**Proposed:** Dynamic allocation with scope quotas and classification priority

**Strategy Overview:**
```
Total Limit: 20 memories (maintains current token cost)

Scope Quotas (minimum guarantees):
├─ Min 6 GLOBAL (preferences, constraints, learning, procedural)
├─ Min 6 PROJECT (decisions, semantic, episodic)
└─ Max 8 flexible (context-relevant from either scope)

Classification Priority (within each scope):
Tier 0: constraint (always include, no limit - critical rules)
Tier 1: preference, decision (high priority)
Tier 2: learning, procedural (medium priority)
Tier 3: semantic, episodic (low priority, context-dependent)
```

**Why dynamic allocation:**
- New user (3 memories): All included, no waste
- Power user (15 high-strength): 6 guaranteed + 14 compete for slots
- Prevents GLOBAL preferences from drowning PROJECT context (and vice versa)

```typescript
async function selectMemoriesForInjection(
  db: MemoryDatabase,
  worktree: string,
  queryContext: string,
  embeddingsEnabled: boolean
): Promise<MemoryUnit[]> {
  const MAX_TOTAL = 20;
  const MIN_GLOBAL = 6;
  const MIN_PROJECT = 6;
  const MAX_FLEXIBLE = 8;
  
  const memories: MemoryUnit[] = [];
  
  // Step 1: Get all memories for current scope (GLOBAL + current PROJECT)
  const allMemories = db.getMemoriesByScope(worktree, 100);
  const globalMemories = allMemories.filter(m => m.project_scope === null);
  const projectMemories = allMemories.filter(m => m.project_scope !== null);
  
  // Step 2: Tier 0 - Include ALL constraints (critical rules, no limit)
  const constraints = allMemories.filter(m => m.classification === 'constraint');
  memories.push(...constraints);
  
  // Step 3: Scope quotas - Minimum guarantees
  // GLOBAL: Top by strength (preference, learning, procedural)
  const globalHigh = globalMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_GLOBAL);
  memories.push(...globalHigh);
  
  // PROJECT: Top by strength (decision, semantic)
  const projectHigh = projectMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_PROJECT);
  memories.push(...projectHigh);
  
  // Step 4: Flexible slots - Context-relevant selection
  const remainingSlots = MAX_TOTAL - memories.length;
  
  if (remainingSlots > 0 && embeddingsEnabled && queryContext.trim().length > 0) {
    // Use vectorSearch for semantic relevance
    const relevant = await db.vectorSearch(queryContext, worktree, MAX_FLEXIBLE);
    
    // Deduplicate and fill remaining slots
    const existingIds = new Set(memories.map(m => m.id));
    const newMemories = relevant.filter(m => !existingIds.has(m.id));
    memories.push(...newMemories.slice(0, remainingSlots));
    
    log(`Dynamic selection: ${memories.length} total (${globalHigh.length} global + ${projectHigh.length} project + ${newMemories.length} context-relevant)`);
  } else if (remainingSlots > 0) {
    // Fallback: Fill with highest strength from either scope
    const remaining = allMemories
      .filter(m => !memories.find(existing => existing.id === m.id))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, remainingSlots);
    memories.push(...remaining);
    
    log(`Fallback selection: ${memories.length} total (strength-based)`);
  }
  
  return memories.slice(0, MAX_TOTAL); // Hard limit
}
```

**Benefits:**
- **Scope protection**: GLOBAL preferences can't drown PROJECT context (min 6 each)
- **Classification priority**: Constraints always included, episodic lowest priority
- **Dynamic allocation**: Adapts to user's actual memory distribution
- **Quality over quantity**: 20 highly relevant > 30 random memories
- **Token stable**: Always 20 memories, cost predictable
- **Graceful degradation**: Works with or without embeddings

### 3.3 Integration Points

**File: `src/adapters/opencode/index.ts`**

**Hook: `experimental.chat.system.transform` (lines 287-318)**

**Current implementation:**
```typescript
'experimental.chat.system.transform': async (input, output) => {
  log('experimental.chat.system.transform: Injecting all relevant memories');

  try {
    const injectionState: InjectionState = {
      db: state.db,
      worktree: state.worktree,
    };

    // CURRENT: Strength-based retrieval
    const allMemories = injectionState.db.getMemoriesByScope(state.worktree, 20);
    
    setLastInjectedMemories(allMemories);

    if (allMemories.length > 0) {
      const wrappedContext = wrapMemories(allMemories, state.worktree, 'global');
      // ... inject into system prompt
    }
  } catch (error) {
    log(`Global injection failed: ${error}`);
  }
}
```

**Proposed implementation:**
```typescript
'experimental.chat.system.transform': async (input, output) => {
  log('experimental.chat.system.transform: Injecting context-relevant memories');

  try {
    // 1. Extract conversation context from input
    const queryContext = extractQueryContextFromInput(input);
    
    // 2. Check if embeddings are enabled
    const embeddingService = EmbeddingService.getInstance();
    const embeddingsEnabled = embeddingService.isEnabled();
    
    // 3. Smart memory selection (tiered approach)
    const allMemories = await selectMemoriesForInjection(
      state.db,
      state.worktree,
      queryContext,
      embeddingsEnabled
    );
    
    setLastInjectedMemories(allMemories);

    if (allMemories.length > 0) {
      const wrappedContext = wrapMemories(allMemories, state.worktree, 'global');
      
      // Handle system as string[]
      const systemArray = Array.isArray(output.system) ? output.system : [output.system];
      const lastElement = systemArray[systemArray.length - 1] || '';
      systemArray[systemArray.length - 1] = `${lastElement}\n\n${wrappedContext}`;

      output.system = systemArray;

      log(`Context-aware injection: ${allMemories.length} memories (embeddings: ${embeddingsEnabled})`);
    }
  } catch (error) {
    log(`Context-aware injection failed: ${error}, falling back to strength-based`);
    
    // Fallback: Original strength-based retrieval
    const fallbackMemories = state.db.getMemoriesByScope(state.worktree, 20);
    setLastInjectedMemories(fallbackMemories);
    
    if (fallbackMemories.length > 0) {
      const wrappedContext = wrapMemories(fallbackMemories, state.worktree, 'global');
      const systemArray = Array.isArray(output.system) ? output.system : [output.system];
      const lastElement = systemArray[systemArray.length - 1] || '';
      systemArray[systemArray.length - 1] = `${lastElement}\n\n${wrappedContext}`;
      output.system = systemArray;
    }
  }
}
```

---

## 4. Implementation Phases

### Phase 1: Context Extraction (Week 1)

**Goal:** Extract query context from conversation

**Files to modify:**
- `src/adapters/opencode/index.ts` - Add `extractQueryContextFromInput()`
- `src/adapters/opencode/injection.ts` - Add helper functions

**Tasks:**
1. Implement `extractQueryContextFromInput(input)` function
2. Handle edge cases (empty input, no text parts, etc.)
3. Add truncation logic (max 500 chars)
4. Add unit tests

**Code location:**
```typescript
// src/adapters/opencode/index.ts (new function, after line 100)

/**
 * Extract query context from hook input for semantic search
 * Uses last N messages to build context window
 */
function extractQueryContextFromInput(input: any): string {
  // Input structure from OpenCode:
  // input = { sessionID: string, ... }
  // We need to fetch recent messages from the session
  
  // For now, return empty string (will be enhanced in Phase 2)
  // This ensures backward compatibility
  return '';
}
```

**Note:** The `experimental.chat.system.transform` hook receives `input` which contains session metadata, but NOT the actual messages. We need to fetch messages via the client API.

### Phase 2: Message Fetching (Week 1-2)

**Goal:** Fetch recent messages from session for context extraction

**Files to modify:**
- `src/adapters/opencode/index.ts` - Enhance `extractQueryContextFromInput()`

**Tasks:**
1. Use `state.client.session.messages()` to fetch recent messages
2. Extract text from message parts
3. Build context window (last 5 messages)
4. Handle errors gracefully (return empty string on failure)

**Code location:**
```typescript
// src/adapters/opencode/index.ts (enhanced function)

async function extractQueryContextFromInput(
  client: PluginInput['client'],
  sessionId: string | undefined
): Promise<string> {
  if (!sessionId) return '';
  
  try {
    const response = await client.session.messages({ path: { id: sessionId } });
    if (response.error || !response.data) return '';
    
    const messages = response.data;
    const recentMessages = messages.slice(-5); // Last 5 messages
    
    const contextParts: string[] = [];
    for (const msg of recentMessages) {
      for (const part of msg.parts) {
        if (part.type === 'text' && 'text' in part) {
          contextParts.push((part as { text: string }).text);
        }
      }
    }
    
    const fullContext = contextParts.join(' | ');
    return fullContext.slice(-500); // Truncate to 500 chars
  } catch (error) {
    log('Failed to extract query context:', error);
    return '';
  }
}
```

### Phase 3: Smart Memory Selection (Week 2)

**Goal:** Implement tiered memory selection with embeddings support

**Files to modify:**
- `src/adapters/opencode/injection.ts` - Add `selectMemoriesForInjection()`

**Tasks:**
1. Implement tiered selection logic
2. Add deduplication
3. Add dynamic limit calculation
4. Add unit tests

**Code location:**
```typescript
// src/adapters/opencode/injection.ts (new function)

/**
 * Select memories for injection using dynamic allocation with scope quotas
 * 
 * Strategy:
 * - Min 6 GLOBAL (preferences, constraints, learning, procedural)
 * - Min 6 PROJECT (decisions, semantic, episodic)
 * - Max 8 flexible (context-relevant from either scope)
 * - Total: 20 memories (maintains current token cost)
 * 
 * Classification Priority:
 * Tier 0: constraint (always include, no limit - critical rules)
 * Tier 1: preference, decision (high priority, by strength)
 * Tier 2: learning, procedural (medium priority, by strength)
 * Tier 3: semantic, episodic (low priority, by query relevance)
 */
export async function selectMemoriesForInjection(
  db: MemoryDatabase,
  worktree: string,
  queryContext: string,
  embeddingsEnabled: boolean
): Promise<MemoryUnit[]> {
  const memories: MemoryUnit[] = [];
  const MAX_TOTAL = 20;
  const MIN_GLOBAL = 6;
  const MIN_PROJECT = 6;
  const MAX_FLEXIBLE = 8;
  
  // Step 1: Get all memories for current scope (GLOBAL + current PROJECT)
  const allMemories = db.getMemoriesByScope(worktree, 100);
  const globalMemories = allMemories.filter(m => m.project_scope === null);
  const projectMemories = allMemories.filter(m => m.project_scope !== null);
  
  // Step 2: Tier 0 - Include ALL constraints (critical rules, no limit)
  const constraints = allMemories.filter(m => m.classification === 'constraint');
  memories.push(...constraints);
  
  // Step 3: Scope quotas - Minimum guarantees
  // GLOBAL: Top by strength (preference, learning, procedural)
  const globalHigh = globalMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_GLOBAL);
  memories.push(...globalHigh);
  
  // PROJECT: Top by strength (decision, semantic)
  const projectHigh = projectMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_PROJECT);
  memories.push(...projectHigh);
  
  // Step 4: Flexible slots - Context-relevant selection
  const remainingSlots = MAX_TOTAL - memories.length;
  
  if (remainingSlots > 0 && embeddingsEnabled && queryContext.trim().length > 0) {
    // Use vectorSearch for semantic relevance
    const relevant = await db.vectorSearch(queryContext, worktree, MAX_FLEXIBLE);
    
    // Deduplicate and fill remaining slots
    const existingIds = new Set(memories.map(m => m.id));
    const newMemories = relevant.filter(m => !existingIds.has(m.id));
    memories.push(...newMemories.slice(0, remainingSlots));
    
    log(`Dynamic selection: ${memories.length} total (${globalHigh.length} global + ${projectHigh.length} project + ${newMemories.length} context-relevant)`);
  } else if (remainingSlots > 0) {
    // Fallback: Fill with highest strength from either scope
    const remaining = allMemories
      .filter(m => !memories.find(existing => existing.id === m.id))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, remainingSlots);
    memories.push(...remaining);
    
    log(`Fallback selection: ${memories.length} total (strength-based)`);
  }
  
  return memories.slice(0, MAX_TOTAL); // Hard limit
}
```

### Phase 4: Hook Integration (Week 2-3)

**Goal:** Integrate smart selection into `experimental.chat.system.transform`

**Files to modify:**
- `src/adapters/opencode/index.ts` - Update hook implementation

**Tasks:**
1. Replace `getMemoriesByScope()` with `selectMemoriesForInjection()`
2. Add error handling with fallback
3. Add logging for debugging
4. Test with embeddings enabled and disabled

**Code changes:**
See Section 3.3 for complete implementation.

### Phase 5: Testing & Validation (Week 3)

**Goal:** Validate implementation works in both modes

**Test scenarios:**

| Scenario | Expected Behavior |
|----------|-------------------|
| Embeddings enabled, context available | Min 6 GLOBAL + Min 6 PROJECT + up to 8 context-relevant = 20 |
| Embeddings enabled, no context | Min 6 GLOBAL + Min 6 PROJECT + 8 highest strength = 20 |
| Embeddings disabled, context available | Min 6 GLOBAL + Min 6 PROJECT + 8 highest strength = 20 |
| Embeddings disabled, no context | Min 6 GLOBAL + Min 6 PROJECT + 8 highest strength = 20 |
| Vector search fails | Graceful fallback to strength-based selection |
| Empty database | Empty array, no errors |
| Many constraints (>6) | All constraints included (may exceed 20 temporarily) |
| Few GLOBAL memories (2) | Use 2 GLOBAL + 18 PROJECT (respects availability) |
| Few PROJECT memories (3) | Use 6 GLOBAL + 3 PROJECT + 11 flexible (respects availability) |

**Test commands:**
```bash
# Test with embeddings enabled
export TRUE_MEM_EMBEDDINGS=1
bun run build
# Test in OpenCode, monitor logs

# Test with embeddings disabled
export TRUE_MEM_EMBEDDINGS=0
bun run build
# Test in OpenCode, verify fallback works
```

---

## 5. Technical Specifications

### 5.1 File Changes Summary

| File | Changes | Lines |
|------|---------|-------|
| `src/adapters/opencode/index.ts` | Add context extraction, update hook | +50 lines |
| `src/adapters/opencode/injection.ts` | Add `selectMemoriesForInjection()` | +60 lines |
| `src/storage/database.ts` | No changes (already has `vectorSearch()`) | 0 |
| `src/memory/embeddings.ts` | No changes (already has `getSimilarity()`) | 0 |

### 5.2 API Changes

**New function: `extractQueryContextFromInput()`**
```typescript
async function extractQueryContextFromInput(
  client: PluginInput['client'],
  sessionId: string | undefined
): Promise<string>
```

**New function: `selectMemoriesForInjection()`**
```typescript
export async function selectMemoriesForInjection(
  db: MemoryDatabase,
  worktree: string,
  queryContext: string,
  embeddingsEnabled: boolean
): Promise<MemoryUnit[]>
```

**No breaking changes to existing APIs.**

### 5.3 Configuration

**No new configuration needed.** Uses existing:
- `TRUE_MEM_EMBEDDINGS=1` (enable embeddings)
- `TRUE_MEM_EMBEDDINGS=0` or unset (Jaccard-only)

### 5.4 Performance Considerations

| Operation | Latency (embeddings enabled) | Latency (Jaccard-only) |
|-----------|------------------------------|------------------------|
| Context extraction | ~50ms (API call) | ~50ms (API call) |
| Vector search | ~100-200ms (hybrid) | ~10ms (Jaccard) |
| Total injection | ~150-250ms | ~60ms |

**Optimization opportunities:**
1. Cache context extraction result (reuse for multiple injections)
2. Pre-compute embeddings for all memories (background task)
3. Use smaller context window (3 messages instead of 5)

---

## 6. Testing Strategy

### 6.1 Unit Tests

**File: `tests/injection.test.ts`**

```typescript
describe('selectMemoriesForInjection', () => {
  it('should include high-strength memories regardless of relevance', async () => {
    // Setup: Create memories with strength 0.9, 0.85, 0.6
    // Assert: First two always included
  });

  it('should add relevant memories when embeddings enabled', async () => {
    // Setup: Enable embeddings, provide context
    // Assert: Relevant memories added via vectorSearch
  });

  it('should fallback to medium-strength when embeddings disabled', async () => {
    // Setup: Disable embeddings
    // Assert: Medium-strength memories included
  });

  it('should deduplicate memories across tiers', async () => {
    // Setup: High-strength memory also relevant
    // Assert: No duplicates in result
  });

  it('should handle empty database gracefully', async () => {
    // Setup: Empty database
    // Assert: Returns empty array, no errors
  });
});
```

### 6.2 Integration Tests

**File: `tests/integration.test.ts`**

```typescript
describe('experimental.chat.system.transform hook', () => {
  it('should inject context-relevant memories with embeddings enabled', async () => {
    // Setup: TRUE_MEM_EMBEDDINGS=1, mock session with messages
    // Execute: Trigger hook
    // Assert: Memories injected, vectorSearch called
  });

  it('should fallback gracefully when embeddings fail', async () => {
    // Setup: TRUE_MEM_EMBEDDINGS=1, mock vectorSearch failure
    // Execute: Trigger hook
    // Assert: Fallback to strength-based, no errors
  });

  it('should work with embeddings disabled', async () => {
    // Setup: TRUE_MEM_EMBEDDINGS=0
    // Execute: Trigger hook
    // Assert: Strength-based retrieval, no vectorSearch call
  });
});
```

### 6.3 Manual Testing

**Test scenarios:**

1. **Fresh start (no memories)**
   - Start OpenCode in new project
   - Verify no errors, empty injection

2. **Build up memories**
   - Have conversation, create memories
   - Verify memories stored correctly

3. **Context-aware retrieval**
   - Ask question related to previous memory
   - Verify relevant memory injected

4. **Embeddings toggle**
   - Toggle `TRUE_MEM_EMBEDDINGS` between 0 and 1
   - Verify both modes work correctly

5. **Error handling**
   - Simulate vector search failure
   - Verify graceful fallback

---

## 7. Rollback Plan

### 7.1 Quick Rollback

If issues arise, revert to original implementation:

```typescript
// src/adapters/opencode/index.ts (experimental.chat.system.transform hook)

'experimental.chat.system.transform': async (input, output) => {
  log('experimental.chat.system.transform: Injecting all relevant memories');

  try {
    // ROLLBACK: Use original strength-based retrieval
    const allMemories = state.db.getMemoriesByScope(state.worktree, 20);
    
    setLastInjectedMemories(allMemories);

    if (allMemories.length > 0) {
      const wrappedContext = wrapMemories(allMemories, state.worktree, 'global');
      
      const systemArray = Array.isArray(output.system) ? output.system : [output.system];
      const lastElement = systemArray[systemArray.length - 1] || '';
      systemArray[systemArray.length - 1] = `${lastElement}\n\n${wrappedContext}`;

      output.system = systemArray;

      log(`Global injection: ${allMemories.length} memories injected into system prompt`);
    }
  } catch (error) {
    log(`Global injection failed: ${error}`);
  }
}
```

### 7.2 Feature Flag Rollback

Disable embeddings without code changes:

```bash
# Disable embeddings globally
export TRUE_MEM_EMBEDDINGS=0

# Or in OpenCode config
# ~/.config/opencode/opencode.jsonc
{
  "env": {
    "TRUE_MEM_EMBEDDINGS": "0"
  }
}
```

### 7.3 Database Rollback

No database schema changes in this implementation, so no rollback needed.

---

## 8. Success Metrics

### 8.1 Functional Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Embeddings used for injection | Yes (when enabled) | Log analysis |
| Fallback works | Yes (when disabled/fails) | Log analysis |
| No crashes | 0 crashes in 100 hours | Manual testing |
| Memory selection time | <250ms | Performance profiling |

### 8.2 Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Relevant memories injected | >80% relevance | User feedback |
| Token cost reduction | 25-50% fewer tokens | Token counting |
| User satisfaction | Positive feedback | User reports |

### 8.3 Stability Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Graceful degradation | Always works | Error handling tests |
| No memory leaks | Stable memory usage | Memory profiling |
| No race conditions | Thread-safe | Concurrency tests |

---

## 9. Future Enhancements

### 9.1 Pre-computed Embeddings

**Current:** Compute embeddings on-the-fly for each query

**Future:** Pre-compute and store embeddings for all memories

**Benefits:**
- Faster retrieval (no embedding computation)
- Better accuracy (consistent embeddings)

**Implementation:**
1. Add `embedding` column to `memory_units` table (already exists!)
2. Compute embedding when memory is created
3. Use stored embedding in `vectorSearch()`

### 9.2 Context Caching

**Current:** Extract context for each injection

**Future:** Cache context for multiple injections in same session

**Benefits:**
- Reduced API calls
- Faster injection

### 9.3 Adaptive Context Window

**Current:** Fixed 5 messages

**Future:** Adaptive window based on conversation length

**Benefits:**
- Better context for long conversations
- Efficiency for short conversations

---

## 10. Conclusion

This implementation plan provides a clear path to make embeddings useful in True-Mem while maintaining backward compatibility and graceful fallback. The tiered approach ensures that:

1. **High-strength memories** (preferences, constraints) are always included
2. **Context-relevant memories** are added when embeddings are available
3. **Graceful fallback** to strength-based retrieval when embeddings fail or are disabled
4. **Token cost reduction** by selecting fewer, more relevant memories

The implementation is low-risk because:
- No breaking changes to existing APIs
- Feature flag allows instant disable
- Fallback logic ensures stability
- No database schema changes

**Estimated timeline:** 3 weeks for full implementation and testing.

**Recommendation:** Proceed with implementation in `develop` branch, test thoroughly, then merge to `main` for v1.3.0 release.
