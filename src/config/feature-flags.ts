/**
 * Feature flags with hot-reload resilience
 * 
 * OpenCode plugin hot-reload creates isolated context without env var inheritance.
 * This module bridges the gap by persisting env var values to config file.
 * 
 * Priority: process.env → config file → false (default)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../logger.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface PluginConfig {
  embeddingsEnabled: boolean;
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
    
    // Update config file for hot-reload scenarios
    saveConfig({ 
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
