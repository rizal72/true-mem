/**
 * Injection Mode Configuration
 * 
 * TRUE_MEM_INJECTION_MODE:
 *   0 = DISABLED - Never inject memories
 *   1 = SESSION_START - Inject only at session start (DEFAULT)
 *   2 = ALWAYS - Inject on every prompt (legacy behavior)
 * 
 * TRUE_MEM_SUBAGENT_MODE:
 *   0 = DISABLED - Don't inject into task/background_task prompts
 *   1 = ENABLED - Inject into sub-agents (DEFAULT)
 */

import { log } from '../logger.js';

export type InjectionMode = 0 | 1 | 2;
export type SubAgentMode = 0 | 1;

export interface InjectionConfig {
  mode: InjectionMode;
  subAgentMode: SubAgentMode;
}

export function parseInjectionMode(): InjectionMode {
  const envValue = process.env.TRUE_MEM_INJECTION_MODE;
  
  if (!envValue) return 1; // Default: SESSION_START
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1, 2].includes(parsed)) {
    log(`Invalid TRUE_MEM_INJECTION_MODE: ${envValue}, using default (1)`);
    return 1;
  }
  
  const mode = parsed as InjectionMode;
  log(`Injection mode: ${mode} (${getModeLabel(mode)})`);
  return mode;
}

export function parseSubAgentMode(): SubAgentMode {
  const envValue = process.env.TRUE_MEM_SUBAGENT_MODE;
  
  if (!envValue) return 1; // Default: enabled
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1].includes(parsed)) {
    log(`Invalid TRUE_MEM_SUBAGENT_MODE: ${envValue}, using default (1)`);
    return 1;
  }
  
  return parsed as SubAgentMode;
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
