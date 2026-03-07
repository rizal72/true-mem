/**
 * Feature flags with hot-reload resilience
 * 
 * OpenCode plugin hot-reload creates isolated context without env var inheritance.
 * This module bridges the gap by persisting env var values to config file.
 * 
 * Priority: process.env → config file → false (default)
 * 
 * ## Feature Flags
 * 
 * | Env Var | Default | Description |
 * |---------|---------|-------------|
 * | TRUE_MEM_EMBEDDINGS | 0 | Enable hybrid embeddings (Jaccard + cosine similarity) |
 * | TRUE_MEM_INJECT_SUBAGENTS | 1 | Inject memories into sub-agent sessions (0=disable) |
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { log } from '../logger.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface PluginConfig {
  embeddingsEnabled: boolean;
  nodePath?: string; // Absolute path to Node.js binary
  lastEnvCheck: string; // ISO timestamp
}

/**
 * Reads embeddings feature flag with hot-reload resilience.
 * 
 * Flow:
 * 1. If process.env.TRUE_MEM_EMBEDDINGS is set → use it, save to config
 * 2. If process.env undefined (hot-reload) → read from config file
 * 3. If no config → default to false
 * 
 * @returns true if embeddings enabled, false otherwise
 */
export function getEmbeddingsEnabled(): boolean {
  // 1. Check process.env FIRST (if available, use it)
  const envValue = process.env.TRUE_MEM_EMBEDDINGS;
  
  if (envValue !== undefined) {
    const enabled = envValue === '1';
    
    // Update config file for hot-reload scenarios (preserve nodePath)
    const existingConfig = readConfig();
    saveConfig({ 
      ...existingConfig,
      embeddingsEnabled: enabled, 
      lastEnvCheck: new Date().toISOString() 
    });
    
    log(`Feature flag from env: TRUE_MEM_EMBEDDINGS=${envValue} → ${enabled}`);
    return enabled;
  }

  // 2. process.env undefined → we're in hot-reload, read from config
  log('Env var undefined (hot-reload), reading from config file');
  
  if (existsSync(CONFIG_FILE)) {
    try {
      const configJson = readFileSync(CONFIG_FILE, 'utf-8');
      const config: PluginConfig = JSON.parse(configJson);
      
      // DEFENSIVE: Validate config structure
      if (typeof config.embeddingsEnabled !== 'boolean') {
        log('Config corrupted (embeddingsEnabled not boolean), using default (disabled)');
        return false;
      }
      
      log(`Feature flag from config: ${config.embeddingsEnabled} (checked at ${config.lastEnvCheck})`);
      return config.embeddingsEnabled;
    } catch (err) {
      // Config corrupted, fallback to default
      log(`Config read error, using default (disabled): ${err}`);
    }
  }

  // 3. Default: embeddings disabled
  log('No config found, using default: embeddings disabled');
  return false;
}

/**
 * Save config to disk for hot-reload resilience
 */
function saveConfig(config: PluginConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    // Non-critical - log and continue
    log(`Config save error: ${err}`);
  }
}

/**
 * Gets the absolute path to Node.js binary with hot-reload resilience.
 * 
 * Flow:
 * 1. If process.env.TRUE_MEM_EMBEDDINGS is set → find node path, save to config
 * 2. If process.env undefined (hot-reload) → read from config file
 * 3. If not found → return 'node' (fallback, may fail)
 * 
 * @returns Absolute path to node binary or 'node' as fallback
 */
export function getNodePath(): string {
  const envValue = process.env.TRUE_MEM_EMBEDDINGS;
  
  // 1. If env var is set, find and cache node path
  if (envValue !== undefined) {
    try {
      const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
      log(`Node.js path resolved: ${nodePath}`);
      
      // Update config with node path (preserve embeddingsEnabled)
      const existingConfig = readConfig();
      saveConfig({
        ...existingConfig,
        nodePath,
        lastEnvCheck: new Date().toISOString()
      });
      
      return nodePath;
    } catch (err) {
      log(`Failed to resolve node path: ${err}`);
      return 'node'; // Fallback
    }
  }
  
  // 2. Hot-reload: read from config
  const config = readConfig();
  if (config.nodePath) {
    log(`Node.js path from config: ${config.nodePath}`);
    return config.nodePath;
  }
  
  // 3. Fallback
  log('Node.js path not found in config, using fallback "node"');
  return 'node';
}

/**
 * Read config file, returns default if not found/corrupted
 */
function readConfig(): PluginConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      const configJson = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(configJson);
    } catch {
      // Ignore errors
    }
  }
  return { embeddingsEnabled: false, lastEnvCheck: '' };
}
