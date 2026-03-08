/**
 * User Configuration Manager
 * 
 * Loads and manages user configuration from config.json with env var override.
 * 
 * Priority (highest to lowest):
 * 1. Environment variables (TRUE_MEM_INJECTION_MODE, TRUE_MEM_SUBAGENT_MODE, TRUE_MEM_MAX_MEMORIES, TRUE_MEM_EMBEDDINGS)
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
import { parseJsonc } from '../utils/jsonc.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const CONFIG_FILE = join(CONFIG_DIR, 'config.jsonc');

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
 * Validate embeddings enabled from file config
 * Returns 0 or 1, or default if invalid
 */
function validateEmbeddingsEnabled(value: unknown): number {
  if (value === 0 || value === 1) return value;
  log(`Config: Invalid embeddingsEnabled in file: ${value}, using default`);
  return DEFAULT_USER_CONFIG.embeddingsEnabled;
}

/**
 * Parse embeddings enabled from env or return default
 * Returns 0 or 1 (number for JSONC config compatibility)
 */
function parseEmbeddingsEnabled(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_USER_CONFIG.embeddingsEnabled;
  
  // Validate input is '0' or '1'
  if (envValue !== '0' && envValue !== '1') {
    log(`Config: Invalid TRUE_MEM_EMBEDDINGS: ${envValue}, using default (${DEFAULT_USER_CONFIG.embeddingsEnabled})`);
    return DEFAULT_USER_CONFIG.embeddingsEnabled;
  }
  
  return parseInt(envValue, 10);
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
      fileConfig = parseJsonc<Partial<TrueMemUserConfig>>(configJson);
      log(`Config: Loaded from ${CONFIG_FILE}`);
    } catch (err) {
      log(`Config: Error reading config.jsonc, using defaults: ${err}`);
    }
  }
  
  // Step 3: Override with environment variables (highest priority)
  // Track if env var was explicitly set to apply correct priority: ENV > FILE > DEFAULTS
  const envInjectionMode = process.env.TRUE_MEM_INJECTION_MODE;
  const envSubagentMode = process.env.TRUE_MEM_SUBAGENT_MODE;
  const envMaxMemories = process.env.TRUE_MEM_MAX_MEMORIES;
  const envEmbeddingsEnabled = process.env.TRUE_MEM_EMBEDDINGS;

  const config: TrueMemUserConfig = {
    injectionMode: envInjectionMode !== undefined
      ? parseInjectionMode(envInjectionMode)
      : (fileConfig.injectionMode ?? DEFAULT_USER_CONFIG.injectionMode),
    subagentMode: envSubagentMode !== undefined
      ? parseSubAgentMode(envSubagentMode)
      : (fileConfig.subagentMode ?? DEFAULT_USER_CONFIG.subagentMode),
    maxMemories: envMaxMemories !== undefined
      ? parseMaxMemories(envMaxMemories)
      : (fileConfig.maxMemories ?? DEFAULT_USER_CONFIG.maxMemories),
    embeddingsEnabled: envEmbeddingsEnabled !== undefined
      ? parseEmbeddingsEnabled(envEmbeddingsEnabled)
      : validateEmbeddingsEnabled(fileConfig.embeddingsEnabled),
  };
  
  // Log the final config
  log(`Config: injectionMode=${config.injectionMode}, subagentMode=${config.subagentMode}, maxMemories=${config.maxMemories}, embeddingsEnabled=${config.embeddingsEnabled}`);
  
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

/**
 * Get embeddings enabled from config (convenience function)
 * Returns 0 or 1 (number for JSONC config compatibility)
 */
export function getEmbeddingsEnabledFromConfig(): number {
  return loadConfig().embeddingsEnabled;
}
