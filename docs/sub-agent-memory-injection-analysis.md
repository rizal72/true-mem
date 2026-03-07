# Sub-Agent Memory Injection Analysis

**Date**: 2026-03-07
**Status**: Research - Not Implemented
**Branch**: develop (testing)

---

## Problem Statement

True-Mem injects memories into **all** requests to the model, including sub-agent calls (task/background_task). This wastes tokens because sub-agents receive full memory context they often don't need.

**Goal**: Inject memories only into the main session, not into sub-agent calls.

---

## Technical Analysis

### Current Behavior

True-Mem uses the `experimental.chat.system.transform` hook which is called **before every request to the model** - both main session and sub-agents.

```
Main Session          Sub-Agent (task)
     │                      │
     ▼                      ▼
experimental.chat.system.transform
     │                      │
     ▼                      ▼
  Inject ALL memories   Inject ALL memories
```

### SessionId Pattern Investigation

**Initial hypothesis**: Sub-agents have sessionId containing `-task-`

**Reality**: All sessionIds have the same format: `ses_<hash>`

Examples from logs:
- `ses_339d24e77ffepq5WZ1fDt0Z7fp` (main session)
- `ses_33a300a74ffeScKGjFX9ZPYYnT` (background_task)

**Conclusion**: OpenCode does NOT distinguish sub-agent sessions in sessionId.

### Hook Structure

```typescript
"experimental.chat.system.transform"?: (input: {
    sessionID?: string;
    model: Model;
}, output: {
    system: string[];
}) => Promise<void>;
```

**No properties** to identify sub-agent calls (no `isSubAgent`, `parentSession`, etc.)

### Root Cause

**OpenCode does NOT provide a way to distinguish sub-agent requests from main session requests.**

Both use:
- Same sessionId
- Same hook (`experimental.chat.system.transform`)
- No flags or metadata

---

## Proposed Solutions

### Solution A: Track Active Tasks (Has Critical Bug)

Track tasks via `callID` and skip injection when tasks are active.

```typescript
const activeTasks = new Set<string>();

// tool.execute.before
if (toolName === 'task' || toolName === 'background_task') {
  activeTasks.add(input.callID);
}

// tool.execute.after
setTimeout(() => activeTasks.delete(input.callID), 5000);

// experimental.chat.system.transform
if (activeTasks.size > 0) return; // Skip injection
```

**CRITICAL BUG**: When background_task is running, the user can still send prompts in the main session. Those prompts would ALSO be skipped.

```
1. User: "Analyze code" → launches background_task
   activeTasks = { 'call-1' }

2. User (main session): "What time is it?"
   activeTasks.size > 0 → SKIP injection ❌ BUG!
```

This solution breaks the main session while background tasks are running.

### Solution B: Environment Variable Only

Simple on/off switch via environment variable.

```bash
export TRUE_MEM_INJECT_SUBAGENTS=0  # Disable completely
```

**Pros**:
- Simple implementation
- User control

**Cons**:
- Not automatic
- Requires manual intervention
- User must know when to enable/disable

### Solution C: Accept Current Limitation

Keep current behavior - sub-agents receive full memory context.

**Pros**:
- Zero changes
- No risk

**Cons**:
- Token waste (~500-1000 tokens per sub-agent)
- Sub-agents may have unnecessary context

### Solution D: Short Timeout After Task Launch

Skip injection only for 2-3 seconds after task launch.

```typescript
const lastTaskLaunchTime = new Map<string, number>();
const INJECTION_BLOCK_DURATION = 2000; // 2 seconds

'tool.execute.before': async (input, output) => {
  if (input.tool === 'task' || input.tool === 'background_task') {
    lastTaskLaunchTime.set(input.sessionID, Date.now());
  }
},

'experimental.chat.system.transform': async (input, output) => {
  const lastTask = lastTaskLaunchTime.get(input.sessionID) || 0;
  if (Date.now() - lastTask < INJECTION_BLOCK_DURATION) {
    return; // Skip
  }
  // ... inject memories
},
```

**Pros**:
- Less impact on main session

**Cons**:
- Still imperfect (race conditions possible)
- Arbitrary timeout value
- May not catch all sub-agent requests

---

## Investigation Needed

To find a proper solution, we need to investigate:

1. **OpenCode source code**: Check if there's any internal flag we can access
2. **Request metadata**: See if hooks receive additional context we're missing
3. **Alternative hooks**: Check if other hooks provide sub-agent information
4. **OpenCode team**: Consider opening a feature request for sub-agent identification

---

## Current Decision

**Status**: Not implementing any solution until we find a reliable way to distinguish sub-agent requests from main session requests.

The risk of breaking main session functionality (Solution A) or requiring manual intervention (Solution B) outweighs the token savings benefit.

**Recommendation**: 
- Keep monitoring OpenCode updates for sub-agent identification features
- Consider opening a GitHub issue/discussion with OpenCode team
- Revisit when OpenCode provides better hooks or metadata

---

## Code to Remove

The function `isSubAgentSession()` (line 146-149 in `src/adapters/opencode/index.ts`) is based on incorrect assumption and should be removed:

```typescript
// REMOVE - Pattern '-task-' does not exist in sessionIds
function isSubAgentSession(sessionId: string): boolean {
  return sessionId.includes('-task-');
}
```

---

## Related

- Commit: `3591ffc` (reverted with `63c4925`)
- Branch: `develop` (testing branch for this feature)
- Issue: GitHub issue #2 (GSD filtering - related to injection optimization)
