# JSONC Config Fix Plan

## Problem Summary

The JSONC parser exists but is NOT being used. The config file is set to `.jsonc` extension but parsing still uses `JSON.parse()`.

## Current Issues

| Issue | File | Line | Problem |
|-------|------|------|---------|
| JSONC not used | `src/config/config.ts` | 111 | Uses `JSON.parse()` instead of `parseJsonc()` |
| Wrong type | `src/types/config.ts` | 25, 45 | `embeddingsEnabled: boolean` should be `number` |
| Wrong default | `src/types/config.ts` | 45 | `embeddingsEnabled: false` should be `0` |
| Returns boolean | `src/config/config.ts` | 83-92 | `parseEmbeddingsEnabled()` returns boolean |
| No template | - | - | Missing distribution template with comments |

## Architecture Decision

**User Config**: Numeric (0|1) - follows user preference for clarity
**Runtime State**: Boolean - internal efficiency
**Conversion**: Happens in `state.ts` when reading from config

```
config.jsonc (0|1) --> state.ts converts --> internal code (boolean)
```

## Implementation Plan

### Phase 1: Fix Types

**File: `src/types/config.ts`**

```typescript
// Change interface
export interface TrueMemUserConfig {
  injectionMode: InjectionMode;
  subagentMode: SubAgentMode;
  maxMemories: number;
  embeddingsEnabled: number;  // was boolean, now 0|1
}

// Change default
export const DEFAULT_USER_CONFIG: TrueMemUserConfig = {
  injectionMode: 0,
  subagentMode: 1,
  maxMemories: 20,
  embeddingsEnabled: 0,  // was false
};
```

### Phase 2: Fix Config Loading

**File: `src/config/config.ts`**

1. **Line 111**: Change `JSON.parse(configJson)` to `parseJsonc<Partial<TrueMemUserConfig>>(configJson)`

2. **Lines 83-92**: Rewrite `parseEmbeddingsEnabled`:
```typescript
function parseEmbeddingsEnabled(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_USER_CONFIG.embeddingsEnabled;
  
  if (envValue !== '0' && envValue !== '1') {
    log(`Config: Invalid TRUE_MEM_EMBEDDINGS: ${envValue}, using default (${DEFAULT_USER_CONFIG.embeddingsEnabled})`);
    return DEFAULT_USER_CONFIG.embeddingsEnabled;
  }
  
  return parseInt(envValue, 10);
}
```

3. **Line 188-189**: Change return type:
```typescript
export function getEmbeddingsEnabledFromConfig(): number {
  return loadConfig().embeddingsEnabled;
}
```

### Phase 3: Fix State Conversion

**File: `src/config/state.ts`**

The state file still uses boolean internally. Update the conversion logic:

1. **Line 60-61**: Convert number to boolean when reading from config:
```typescript
const userConfigEnabled = getEmbeddingsEnabledFromConfig();
if (userConfigEnabled !== (DEFAULT_STATE.embeddingsEnabled ? 1 : 0)) {
  // ... save as boolean to state
}
```

Actually, cleaner approach - just compare after conversion:
```typescript
const userConfigEnabledNum = getEmbeddingsEnabledFromConfig();
const userConfigEnabled = userConfigEnabledNum === 1;
if (userConfigEnabled !== DEFAULT_STATE.embeddingsEnabled) {
  // ...
}
```

### Phase 4: Create Template

**File: `src/templates/config.jsonc`** (new file)

```jsonc
{
  // Injection mode: 0 = session start only (recommended), 1 = every prompt
  "injectionMode": 0,
  
  // Sub-agent mode: 0 = disabled, 1 = enabled (default)
  "subagentMode": 1,
  
  // Embeddings: 0 = Jaccard similarity only, 1 = hybrid (Jaccard + embeddings)
  "embeddingsEnabled": 0,
  
  // Maximum memories to inject per prompt (10-50 recommended)
  "maxMemories": 20
}
```

### Phase 5: Update saveConfig (Optional Enhancement)

**File: `src/config/config.ts` - Line 157**

Current `saveConfig()` overwrites the file with plain JSON, losing comments.

**Options:**
1. **Simple**: Accept that manual edits with comments are preserved until next programmatic save
2. **Better**: Don't rewrite entire file, only update changed values preserving structure
3. **Best**: Store a template reference and only save non-default values

**Recommendation**: Option 1 for now - users who edit config.jsonc manually understand the tradeoff.

## Files Modified

| File | Changes |
|------|---------|
| `src/types/config.ts` | embeddingsEnabled: boolean -> number |
| `src/config/config.ts` | Use parseJsonc, return number |
| `src/config/state.ts` | Convert number to boolean |
| `src/templates/config.jsonc` | NEW - template with comments |

## Testing

1. Create `~/.true-mem/config.jsonc` with comments
2. Start OpenCode - verify config loads
3. Check logs for correct values
4. Test env var override still works

## No Migration Needed

v1.3.0 never released. Clean slate. Users creating new config.jsonc will have correct format.
