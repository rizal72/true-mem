/**
 * Injection Mode Configuration
 * 
 * Provides injection and sub-agent mode settings.
 * Now uses loadConfig() from config.ts for unified config management.
 * 
 * TRUE_MEM_INJECTION_MODE:
 *   0 = SESSION_START - Inject only at session start (DEFAULT)
 *   1 = ALWAYS - Inject on every prompt (legacy behavior)
 * 
 * TRUE_MEM_SUBAGENT_MODE:
 *   0 = DISABLED - Don't inject into task/background_task prompts
 *   1 = ENABLED - Inject into sub-agents (DEFAULT)
 * 
 * These can also be set in config.json or overridden by environment variables.
 */

import { loadConfig } from './config.js';
import type { InjectionMode, SubAgentMode } from '../types/config.js';

export interface InjectionConfig {
  mode: InjectionMode;
  subAgentMode: SubAgentMode;
}

/**
 * Get injection mode from config
 */
export function parseInjectionMode(): InjectionMode {
  return loadConfig().injectionMode;
}

/**
 * Get sub-agent mode from config
 */
export function parseSubAgentMode(): SubAgentMode {
  return loadConfig().subagentMode;
}

/**
 * Get complete injection config
 */
export function getInjectionConfig(): InjectionConfig {
  const config = loadConfig();
  return {
    mode: config.injectionMode,
    subAgentMode: config.subagentMode,
  };
}
