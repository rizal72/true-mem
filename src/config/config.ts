/**
 * User Configuration Manager
 * 
 * Loads and manages user configuration from config.json with env var override.
 * 
 * Priority (highest to lowest):
 * 1. Environment variables (TRUE_MEM_INJECTION_MODE, TRUE_MEM_SUBAGENT_MODE, TRUE_MEM_MAX_MEMORIES)
 * 2. config.json file
 * 3. Default values
 * 
 * Config file: ~/.true-mem/config.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../logger.js';
import type { TrueMemUserConfig, InjectionMode, SubAgentMode } from '../types/config.js';
import { DEFAULT_USER_CONFIG } from '../types/config.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Parse injection mode from env or return default
 */
function parseInjectionMode(envValue: string | undefined): InjectionMode {
  if (!envValue) return DEFAULT_USER_CONFIG.injectionMode;
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1].includes(parsed)) {
    log(`Config: Invalid TRUE_MEM_INJECTION_MODE: ${envValue}, using default (${DEFAULT_USER_CONFIG.injectionMode})`);
    return DEFAULT_USER_CONFIG.injectionMode;
  }
  
  return parsed as InjectionMode;
}

/**
 * Parse sub-agent mode from env or return default
 */
function parseSubAgentMode(envValue: string | undefined): SubAgentMode {
  if (!envValue) return DEFAULT_USER_CONFIG.subagentMode;
  
  const parsed = parseInt(envValue, 10);
  
  if (![0, 1].includes(parsed)) {
    log(`Config: Invalid TRUE_MEM_SUBAGENT_MODE: ${envValue}, using default (${DEFAULT_USER_CONFIG.subagentMode})`);
    return DEFAULT_USER_CONFIG.subagentMode;
  }
  
  return parsed as SubAgentMode;
}

/**
 * Parse max memories from env or return default
 */
function parseMaxMemories(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_USER_CONFIG.maxMemories;
  
  const parsed = parseInt(envValue, 10);
  
  if (isNaN(parsed) || parsed < 1) {
    log(`Config: Invalid TRUE_MEM_MAX_MEMORIES: ${envValue}, using default (${DEFAULT_USER_CONFIG.maxMemories})`);
    return DEFAULT_USER_CONFIG.maxMemories;
  }
  
  if (parsed < 10) {
    log(`Config: Warning TRUE_MEM_MAX_MEMORIES=${parsed} may reduce context quality`);
  }
  if (parsed > 50) {
    log(`Config: Warning TRUE_MEM_MAX_MEMORIES=${parsed} may cause token bloat`);
  }
  
  return parsed;
}

/**
 * Load user configuration
 * 
 * Flow:
 * 1. Start with defaults
 * 2. Override with config.json if exists
 * 3. Override with environment variables (highest priority)
 * 
 * @returns User configuration object
 */
export function loadConfig(): TrueMemUserConfig {
  let fileConfig: Partial<TrueMemUserConfig> = {};
  
  // Step 2: Load from config.json if exists
  if (existsSync(CONFIG_FILE)) {
    try {
      const configJson = readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(configJson);
      log(`Config: Loaded from ${CONFIG_FILE}`);
    } catch (err) {
      log(`Config: Error reading config.json, using defaults: ${err}`);
    }
  }
  
  // Step 3: Override with environment variables (highest priority)
  const injectionMode = parseInjectionMode(process.env.TRUE_MEM_INJECTION_MODE);
  const subagentMode = parseSubAgentMode(process.env.TRUE_MEM_SUBAGENT_MODE);
  const maxMemories = parseMaxMemories(process.env.TRUE_MEM_MAX_MEMORIES);
  
  const config: TrueMemUserConfig = {
    injectionMode: fileConfig.injectionMode ?? injectionMode,
    subagentMode: fileConfig.subagentMode ?? subagentMode,
    maxMemories: fileConfig.maxMemories ?? maxMemories,
  };
  
  // Log the final config
  log(`Config: injectionMode=${config.injectionMode}, subagentMode=${config.subagentMode}, maxMemories=${config.maxMemories}`);
  
  return config;
}

/**
 * Save user configuration to disk
 */
export function saveConfig(config: Partial<TrueMemUserConfig>): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    const currentConfig = loadConfig();
    const newConfig = { ...currentConfig, ...config };
    writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    log(`Config: Saved to ${CONFIG_FILE}`);
  } catch (err) {
    log(`Config: Error saving: ${err}`);
  }
}

/**
 * Get injection mode (convenience function)
 */
export function getInjectionMode(): InjectionMode {
  return loadConfig().injectionMode;
}

/**
 * Get sub-agent mode (convenience function)
 */
export function getSubAgentMode(): SubAgentMode {
  return loadConfig().subagentMode;
}

/**
 * Get max memories (convenience function)
 */
export function getMaxMemories(): number {
  return loadConfig().maxMemories;
}
