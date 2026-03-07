# Token Optimization Plan - True-Mem

**Date**: 2026-03-07
**Version**: 1.0.0
**Status**: Architecture Plan - Not Implemented
**Target Branch**: `develop` (testing) → `main` (release)

---

## Problem Statement

True-Mem injects memories into EVERY prompt via `experimental.chat.system.transform` hook. This wastes tokens:

- **Token cost**: 20 memories × ~50 tokens = ~1000 tokens per prompt
- **Frequency**: Every model request (main session + sub-agents)
- **Impact**: 
  - OpenCode Go: Limited quota consumption
  - OpenCode Zen / OpenRouter: Pay-per-use costs
  - Sub-agents: Receive context they often don't need

**Goal**: Inject memories ONLY at session start, with configurable fallback to current behavior.

---

## Current Architecture

### Hook Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenCode Plugin Hooks                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  event: session.created                                      │
│    └─ Fires once when session starts                         │
│                                                              │
│  event: session.idle                                         │
│    └─ Fires after conversation turn                          │
│    └─ Used for memory extraction                             │
│                                                              │
│  experimental.chat.system.transform                          │
│    └─ Fires BEFORE EVERY model request                       │
│    └─ Main session, sub-agents, ALL requests                │
│    └─ Current injection point (line 390-432)                 │
│                                                              │
│  tool.execute.before                                         │
│    └─ Fires before task/background_task                      │
│    └─ Sub-agent specific injection (line 338-375)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Injection Flow (Current)

```
User Message → Model Request → experimental.chat.system.transform
                                       │
                                       ▼
                               selectMemoriesForInjection()
                                       │
                                       ▼
                               wrapMemories() → XML
                                       │
                                       ▼
                               Inject into system prompt
                                       │
                                       ▼
                               Send to model (with memories)
```

**Problem**: This fires for EVERY request, including sub-agents.

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/adapters/opencode/index.ts` | Main hook implementation | 390-432 (main), 338-375 (sub-agent) |
| `src/adapters/opencode/injection.ts` | Memory selection & wrapping | 149-249 |
| `src/config.ts` | Configuration defaults | 66-74 (OpenCodeConfig) |
| `src/types.ts` | Type definitions | 378-386 (OpenCodeConfig) |

---

## Constraints & Requirements

### Hard Constraints

1. **NO `session.start` hook exists** - OpenCode v1.2.10 doesn't provide this
2. **NO sub-agent metadata** - Can't reliably distinguish main session from sub-agents
3. **Backward compatible** - Existing users shouldn't break
4. **Numeric env vars** - User preference: `0, 1, 2` with comments, NOT strings

### User Requirements

1. **Default behavior**: Inject ONLY at session start (new or continued with `opencode -c`)
2. **Configurable**: Option to restore current "always inject" behavior
3. **Phased approach**: Minimize risk with incremental rollout
4. **Document in AGENTS.md**: After implementation

### Design Principles

- **Minimal changes**: Add new modules, don't rewrite existing ones
- **Feature flags**: New behavior controlled by config
- **Graceful degradation**: If new logic fails, fall back to safe behavior
- **Observable**: Clear logging for debugging

---

## Proposed Architecture

### Solution: Injection Mode Config

Use `experimental.chat.system.transform` with mode-based logic:

```
┌─────────────────────────────────────────────────────────────┐
│                  Injection Mode Config                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  TRUE_MEM_INJECTION_MODE=0                                   │
│    └─ DISABLED: Never inject memories                       │
│    └─ Use case: Debug, temporary disable                    │
│                                                              │
│  TRUE_MEM_INJECTION_MODE=1  (DEFAULT - NEW)                 │
│    └─ SESSION_START: Inject only at session start           │
│    └─ Use case: Token optimization (primary goal)           │
│                                                              │
│  TRUE_MEM_INJECTION_MODE=2  (LEGACY)                        │
│    └─ ALWAYS: Inject on every prompt (current behavior)     │
│    └─ Use case: Maximum context, backward compatibility     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Session Start Detection

Since no `session.start` hook exists, use `session.created` event + tracker:

```
session.created event
        │
        ▼
  Mark session as "injected=false"
        │
        ▼
  First chat.system.transform call
        │
        ▼
  Inject memories
        │
        ▼
  Mark session as "injected=true"
        │
        ▼
  Subsequent calls → Skip injection
```

### Sub-Agent Handling

**Phase 1**: Keep current sub-agent injection via `tool.execute.before` (unchanged)

**Phase 2** (optional): Add separate sub-agent control:

```
TRUE_MEM_SUBAGENT_MODE=0  # Disable sub-agent injection
TRUE_MEM_SUBAGENT_MODE=1  # Enable (current behavior)
```

---

## Implementation Plan

### Phase 1: Configurable Injection Strategy

**Goal**: Add injection mode config with session-start detection.

**Files to Create/Modify**:

```
src/
├── config/
│   └── injection-mode.ts     # NEW: Mode parsing & validation
├── adapters/opencode/
│   ├── index.ts              # MODIFY: Add mode logic to hook
│   └── injection-tracker.ts  # NEW: Track injected sessions
└── types.ts                  # MODIFY: Add InjectionMode type
```

#### Step 1.1: Define Types

**File**: `src/types.ts`

```typescript
// Injection mode configuration
export type InjectionMode = 0 | 1 | 2;

export interface InjectionConfig {
  mode: InjectionMode;
  subAgentMode: 0 | 1;  // 0=disabled, 1=enabled
}

// Add to OpenCodeConfig
export interface OpenCodeConfig {
  // ... existing fields
  injection: InjectionConfig;
}
```

#### Step 1.2: Create Injection Mode Parser

**File**: `src/config/injection-mode.ts`

```typescript
/**
 * Injection Mode Configuration
 * 
 * TRUE_MEM_INJECTION_MODE:
 *   0 = DISABLED - Never inject memories
 *   1 = SESSION_START - Inject only at session start (DEFAULT)
 *   2 = ALWAYS - Inject on every prompt (legacy behavior)
 */

import { log } from '../logger.js';
import type { InjectionMode, InjectionConfig } from '../types.js';

export function parseInjectionMode(): InjectionMode {
  const envValue = process.env.TRUE_MEM_INJECTION_MODE;
  
  if (!envValue) return 1; // Default: SESSION_START
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1, 2].includes(parsed)) {
    log(`Invalid TRUE_MEM_INJECTION_MODE: ${envValue}, using default (1)`);
    return 1;
  }
  
  log(`Injection mode: ${parsed} (${getModeLabel(parsed)})`);
  return parsed as InjectionMode;
}

export function parseSubAgentMode(): 0 | 1 {
  const envValue = process.env.TRUE_MEM_SUBAGENT_MODE;
  
  if (!envValue) return 1; // Default: enabled
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1].includes(parsed)) {
    log(`Invalid TRUE_MEM_SUBAGENT_MODE: ${envValue}, using default (1)`);
    return 1;
  }
  
  return parsed as 0 | 1;
}

export function getInjectionConfig(): InjectionConfig {
  return {
    mode: parseInjectionMode(),
    subAgentMode: parseSubAgentMode(),
  };
}

function getModeLabel(mode: InjectionMode): string {
  switch (mode) {
    case 0: return 'DISABLED';
    case 1: return 'SESSION_START';
    case 2: return 'ALWAYS';
  }
}
```

#### Step 1.3: Create Injection Tracker

**File**: `src/adapters/opencode/injection-tracker.ts`

```typescript
/**
 * Injection Tracker
 * Tracks which sessions have received memory injection
 */

import { log } from '../../logger.js';

// Track injected sessions (sessionId → injected)
const injectedSessions = new Map<string, boolean>();

// Track session creation order (for resume detection)
const sessionOrder: string[] = [];

/**
 * Mark session as created (called on session.created event)
 */
export function markSessionCreated(sessionId: string): void {
  sessionOrder.push(sessionId);
  injectedSessions.set(sessionId, false);
  log(`Session created: ${sessionId} (total: ${sessionOrder.length})`);
}

/**
 * Check if session has been injected
 */
export function hasInjected(sessionId: string): boolean {
  return injectedSessions.get(sessionId) === true;
}

/**
 * Mark session as injected
 */
export function markInjected(sessionId: string): void {
  injectedSessions.set(sessionId, true);
  log(`Session injected: ${sessionId}`);
}

/**
 * Check if this is likely a resumed session
 * Heuristic: If session has existing messages, it's resumed
 */
export async function isResumedSession(
  client: PluginInput['client'],
  sessionId: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionId } });
    if (response.error || !response.data) return false;
    
    // If more than 1 message exists, this is a resumed session
    const isResumed = response.data.length > 1;
    if (isResumed) {
      log(`Resumed session detected: ${sessionId} (${response.data.length} messages)`);
    }
    return isResumed;
  } catch (error) {
    log(`Failed to check session resume status: ${error}`);
    return false;
  }
}

/**
 * Clear tracking for ended sessions (prevent memory leak)
 */
export function clearSession(sessionId: string): void {
  injectedSessions.delete(sessionId);
  const index = sessionOrder.indexOf(sessionId);
  if (index > -1) {
    sessionOrder.splice(index, 1);
  }
  log(`Session cleared: ${sessionId}`);
}

/**
 * Get stats for debugging
 */
export function getTrackerStats(): {
  totalSessions: number;
  injectedCount: number;
  pendingCount: number;
} {
  let injected = 0;
  let pending = 0;
  
  for (const status of injectedSessions.values()) {
    if (status) injected++;
    else pending++;
  }
  
  return {
    totalSessions: injectedSessions.size,
    injectedCount: injected,
    pendingCount: pending,
  };
}
```

#### Step 1.4: Modify Main Hook

**File**: `src/adapters/opencode/index.ts`

Changes to `experimental.chat.system.transform`:

```typescript
'experimental.chat.system.transform': async (input, output) => {
  const sessionId = input.sessionID ?? state.currentSessionId;
  const injectionMode = state.config.opencode.injection.mode;
  
  // Mode 0: DISABLED - Skip all injection
  if (injectionMode === 0) {
    log('Injection disabled (mode=0)');
    return;
  }
  
  // Mode 1: SESSION_START - Inject only once per session
  if (injectionMode === 1) {
    if (hasInjected(sessionId)) {
      log(`Skipping injection: already injected session ${sessionId}`);
      return;
    }
    
    // Check if resumed session needs injection
    const isResumed = await isResumedSession(state.client, sessionId);
    if (isResumed && hasInjected(sessionId)) {
      log(`Skipping injection: resumed session already injected`);
      return;
    }
  }
  
  // Mode 2: ALWAYS - Continue with injection (current behavior)
  
  log(`Injecting memories (mode=${injectionMode})`);
  
  try {
    // ... existing injection logic ...
    
    // Mark as injected after successful injection
    if (injectionMode === 1) {
      markInjected(sessionId);
    }
  } catch (error) {
    log(`Injection failed: ${error}`);
  }
}
```

#### Step 1.5: Update Config

**File**: `src/config.ts`

```typescript
import { getInjectionConfig } from './config/injection-mode.js';

export const DEFAULT_OPENCODE_CONFIG: OpenCodeConfig = {
  injectOnCompaction: true,
  extractOnCompaction: true,
  extractOnMessage: true,
  maxCompactionMemories: 10,
  maxSessionStartMemories: 10,
  messageWindowSize: 3,
  messageImportanceThreshold: 0.5,
  injection: getInjectionConfig(), // NEW
};
```

---

### Phase 2: Session Resume Detection

**Goal**: Detect `opencode -c` resumed sessions and re-inject.

**Challenge**: OpenCode doesn't provide "is this resumed?" flag.

**Heuristic**: Check message count on first `chat.system.transform` call.

```
First chat.system.transform
        │
        ▼
  Fetch session messages
        │
        ▼
  messages.length > 1?
     │         │
    YES        NO
     │         │
     ▼         ▼
  Resumed    New session
  session    → inject
     │
     ▼
  Check if already has
  true_memory_context
     │
     ▼
  Inject if missing
```

**Implementation**:

```typescript
// In injection-tracker.ts

export async function shouldInjectResumedSession(
  client: PluginInput['client'],
  sessionId: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionId } });
    if (response.error || !response.data) return true; // Safe default
    
    // Check if any message already contains true_memory_context
    for (const msg of response.data) {
      for (const part of msg.parts) {
        if (part.type === 'text' && 'text' in part) {
          const text = (part as { text: string }).text;
          if (text.includes('<true_memory_context')) {
            log(`Resumed session already has memory context`);
            return false;
          }
        }
      }
    }
    
    // No memory context found, should inject
    return true;
  } catch (error) {
    log(`Failed to check resumed session: ${error}`);
    return true; // Safe default: inject
  }
}
```

---

### Phase 3: Sub-Agent Optimization (Optional)

**Goal**: Separate control for sub-agent injection.

**Current**: `tool.execute.before` always injects 10 memories.

**Proposed**: Add `TRUE_MEM_SUBAGENT_MODE` config.

```typescript
// In tool.execute.before hook
'tool.execute.before': async (input, output) => {
  const subAgentMode = state.config.opencode.injection.subAgentMode;
  
  if (subAgentMode === 0) {
    log('Sub-agent injection disabled');
    return;
  }
  
  // ... existing injection logic ...
}
```

**Risk**: Sub-agents might need context. Keep disabled by default, add opt-in.

---

## Configuration Schema

### Environment Variables

```bash
# Injection Mode
# 0 = DISABLED - Never inject memories
# 1 = SESSION_START - Inject only at session start (DEFAULT, recommended)
# 2 = ALWAYS - Inject on every prompt (legacy, higher token cost)
export TRUE_MEM_INJECTION_MODE=1

# Sub-Agent Injection
# 0 = DISABLED - Don't inject into task/background_task prompts
# 1 = ENABLED - Inject into sub-agents (DEFAULT)
export TRUE_MEM_SUBAGENT_MODE=1
```

### Type Definitions

```typescript
// src/types.ts

export type InjectionMode = 0 | 1 | 2;

export interface InjectionConfig {
  mode: InjectionMode;
  subAgentMode: 0 | 1;
}

export interface OpenCodeConfig {
  // ... existing fields
  injection: InjectionConfig;
}
```

---

## Testing Strategy

### Phase 1 Tests

| Test Case | Expected Result |
|-----------|-----------------|
| New session with mode=1 | Inject once, skip subsequent |
| Continued session with mode=1 | Inject once at start |
| Session with mode=2 | Inject on every prompt |
| Session with mode=0 | No injection |
| Multiple prompts in same session | Only first injects (mode=1) |

### Phase 2 Tests

| Test Case | Expected Result |
|-----------|-----------------|
| `opencode -c` with existing context | Skip if memories already present |
| `opencode -c` without context | Inject at first prompt |
| Resumed session with compaction | Re-inject if context lost |

### Manual Testing

```bash
# Test 1: New session
opencode
> "hello"  # Should see "Injected X memories" in log
> "how are you"  # Should see "Skipping injection"

# Test 2: Mode=2 (legacy)
TRUE_MEM_INJECTION_MODE=2 opencode
> "hello"  # Should inject
> "how are you"  # Should inject again

# Test 3: Mode=0 (disabled)
TRUE_MEM_INJECTION_MODE=0 opencode
> "hello"  # Should NOT inject

# Test 4: Resumed session
opencode
> "remember I like TypeScript"
# Exit
opencode -c
> "what do you know about me?"  # Should have context
```

---

## Rollback Plan

### If Issues Arise

1. **Immediate rollback**: Set `TRUE_MEM_INJECTION_MODE=2` (legacy behavior)
2. **Code rollback**: Revert to previous commit
3. **Feature flag**: Mode=2 ensures backward compatibility

### Safe Defaults

- Default mode=1 (SESSION_START) for new installs
- Documentation should explain trade-offs
- Log file shows injection decisions for debugging

---

## Token Savings Estimate

### Current Behavior (Mode=2)

```
Per session:
- User prompts: ~20
- Sub-agent calls: ~5
- Total injections: 25
- Tokens per injection: ~1000
- Total tokens: 25,000
```

### New Behavior (Mode=1)

```
Per session:
- Session start injection: 1
- Sub-agent injections: 5 (unchanged)
- Total injections: 6
- Tokens per injection: ~1000
- Total tokens: 6,000

Savings: 19,000 tokens (76% reduction)
```

### Cost Impact (OpenRouter example)

| Provider | Model | Cost/1K tokens | Session cost (old) | Session cost (new) | Savings |
|----------|-------|----------------|--------------------|--------------------|---------|
| OpenRouter | GPT-4 | $0.03 | $0.75 | $0.18 | $0.57 |
| OpenRouter | Claude | $0.015 | $0.375 | $0.09 | $0.285 |
| OpenCode Go | Any | Quota | 25 units | 6 units | 19 units |

**Per-session savings**: ~76% token reduction

---

## Implementation Checklist

### Phase 1: Core Implementation

- [ ] Create `src/config/injection-mode.ts`
- [ ] Create `src/adapters/opencode/injection-tracker.ts`
- [ ] Add `InjectionMode` type to `src/types.ts`
- [ ] Update `src/config.ts` with injection config
- [ ] Modify `experimental.chat.system.transform` hook
- [ ] Update `session.created` event handler
- [ ] Add unit tests for injection mode parser
- [ ] Add integration tests for session tracking

### Phase 2: Resume Detection

- [ ] Implement `isResumedSession()` check
- [ ] Implement `shouldInjectResumedSession()` check
- [ ] Add tests for resumed session handling
- [ ] Document `opencode -c` behavior

### Phase 3: Sub-Agent Control (Optional)

- [ ] Add `TRUE_MEM_SUBAGENT_MODE` config
- [ ] Modify `tool.execute.before` hook
- [ ] Add tests for sub-agent modes
- [ ] Document sub-agent injection behavior

### Documentation

- [ ] Update AGENTS.md with new config options
- [ ] Update README.md with injection modes
- [ ] Add migration guide for existing users
- [ ] Update CHANGELOG.md

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session tracker memory leak | High | Clear on session end, max 100 sessions |
| Race condition in first injection | Medium | Atomic check-and-set in tracker |
| Resumed session not detected | Medium | Multiple heuristics (message count, context check) |
| Sub-agents lose needed context | Low | Keep sub-agent injection enabled by default |
| Users surprised by behavior change | Medium | Clear documentation, mode=2 for legacy |

---

## Future Enhancements

1. **Smart injection**: Use semantic relevance to decide when to re-inject
2. **Context freshness**: Re-inject if last injection was > N turns ago
3. **Adaptive mode**: Auto-switch between modes based on token budget
4. **Per-project config**: Different modes for different projects
5. **Injection analytics**: Track token savings in database

---

## References

- [Existing Analysis](./sub-agent-memory-injection-analysis.md)
- [OpenCode Plugin API](https://github.com/opencode-ai/opencode)
- [PsychMem Reference](https://github.com/muratg98/psychmem)
- [AGENTS.md](../AGENTS.md) - Project conventions

---

## Appendix: Hook Timing Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     OpenCode Session Lifecycle                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  T=0  session.created                                             │
│        │                                                          │
│        └─► markSessionCreated()                                   │
│                                                                   │
│  T=1  User sends first message                                    │
│        │                                                          │
│        └─► chat.message (user text)                               │
│                                                                   │
│  T=2  experimental.chat.system.transform                          │
│        │                                                          │
│        ├─► mode=0? → Skip                                         │
│        ├─► mode=1? → Check hasInjected()                          │
│        │      ├─► No? → Inject, markInjected()                    │
│        │      └─► Yes? → Skip                                     │
│        └─► mode=2? → Always inject                                │
│                                                                   │
│  T=3  Model generates response                                    │
│        │                                                          │
│        └─► (no hooks fire)                                        │
│                                                                   │
│  T=4  session.idle                                                │
│        │                                                          │
│        └─► Memory extraction (existing)                           │
│                                                                   │
│  T=5  User sends second message                                   │
│        │                                                          │
│        └─► chat.message                                           │
│        └─► experimental.chat.system.transform                     │
│               │                                                   │
│               └─► mode=1? → hasInjected()=true → Skip             │
│                                                                   │
│  T=6  Orchestrator delegates to sub-agent                         │
│        │                                                          │
│        ├─► tool.execute.before                                    │
│        │      └─► subAgentMode=1? → Inject 10 memories            │
│        │                                                          │
│        └─► experimental.chat.system.transform (sub-agent)         │
│               │                                                   │
│               └─► mode=1? → Different sessionId, injects again    │
│                          (LIMITATION: can't distinguish)          │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

**End of Plan**

*Next Step: Review and approve plan before implementation.*
