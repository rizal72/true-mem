/**
 * True-Mem Configuration Types
 * 
 * Separates user configuration (config.json) from runtime state (state.json)
 */

/**
 * Injection mode types
 */
export type InjectionMode = 0 | 1;

/**
 * Sub-agent mode types  
 */
export type SubAgentMode = 0 | 1;

/**
 * User configuration - persistent settings that users can customize
 * Stored in: ~/.true-mem/config.json
 */
export interface TrueMemUserConfig {
  injectionMode: InjectionMode;
  subagentMode: SubAgentMode;
  maxMemories: number;
  embeddingsEnabled: number;
}

/**
 * Runtime state - internal plugin state (not user-facing)
 * Stored in: ~/.true-mem/state.json
 */
export interface TrueMemState {
  embeddingsEnabled: boolean;
  lastEnvCheck: string | null;
  nodePath: string | null;
}

/**
 * Default user configuration
 */
export const DEFAULT_USER_CONFIG: TrueMemUserConfig = {
  injectionMode: 1,      // ALWAYS - real-time memory updates
  subagentMode: 1,       // ENABLED
  maxMemories: 20,
  embeddingsEnabled: 0,
};

/**
 * Default runtime state
 */
export const DEFAULT_STATE: TrueMemState = {
  embeddingsEnabled: false,
  lastEnvCheck: null,
  nodePath: null,
};
