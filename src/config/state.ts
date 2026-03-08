/**
 * Runtime State Management
 * 
 * Persists runtime state to state.json for hot-reload resilience.
 * This is NOT user configuration - it's internal plugin state.
 * 
 * OpenCode plugin hot-reload creates isolated context without env var inheritance.
 * This module bridges the gap by persisting env var values to state file.
 * 
 * For embeddingsEnabled, also checks user config (config.json) as fallback:
 * Priority: process.env → user config (config.json) → state file → false (default)
 * 
 * State file: ~/.true-mem/state.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { log } from '../logger.js';
import type { TrueMemState } from '../types/config.js';
import { DEFAULT_STATE } from '../types/config.js';
import { getEmbeddingsEnabledFromConfig } from './config.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const STATE_FILE = join(CONFIG_DIR, 'state.json');

/**
 * Reads embeddings feature flag with hot-reload resilience.
 * 
 * Flow:
 * 1. If process.env.TRUE_MEM_EMBEDDINGS is set → use it, save to state
 * 2. If process.env undefined → check user config (config.json)
 * 3. If user config undefined → read from state file (hot-reload)
 * 4. If no state → default to false
 * 
 * @returns true if embeddings enabled, false otherwise
 */
export function getEmbeddingsEnabled(): boolean {
  // 1. Check process.env FIRST (if available, use it)
  const envValue = process.env.TRUE_MEM_EMBEDDINGS;
  
  if (envValue !== undefined) {
    const enabled = envValue === '1';
    
    // Update state file for hot-reload scenarios (preserve nodePath)
    const existingState = loadState();
    saveState({ 
      ...existingState,
      embeddingsEnabled: enabled, 
      lastEnvCheck: new Date().toISOString() 
    });
    
    log(`State: TRUE_MEM_EMBEDDINGS=${envValue} → ${enabled}`);
    return enabled;
  }

  // 2. process.env undefined → check user config (config.json)
  log('State: env var undefined, checking user config (config.json)');
  const userConfigEnabledNum = getEmbeddingsEnabledFromConfig();
  const userConfigEnabled = userConfigEnabledNum === 1;
  if (userConfigEnabled !== DEFAULT_STATE.embeddingsEnabled) {
    // Update state file to persist user config choice
    const existingState = loadState();
    saveState({
      ...existingState,
      embeddingsEnabled: userConfigEnabled,
      lastEnvCheck: new Date().toISOString()
    });
    log(`State: User config embeddingsEnabled=${userConfigEnabled}`);
    return userConfigEnabled;
  }
  
  // 3. User config not set → read from state file (hot-reload scenario)
  log('State: user config not set, reading from state.json');
  
  if (existsSync(STATE_FILE)) {
    try {
      const stateJson = readFileSync(STATE_FILE, 'utf-8');
      const state: TrueMemState = JSON.parse(stateJson);
      
      // DEFENSIVE: Validate state structure
      if (typeof state.embeddingsEnabled !== 'boolean') {
        log('State corrupted (embeddingsEnabled not boolean), using default (disabled)');
        return false;
      }
      
      log(`State: embeddingsEnabled=${state.embeddingsEnabled} (checked at ${state.lastEnvCheck})`);
      return state.embeddingsEnabled;
    } catch (err) {
      // State corrupted, fallback to default
      log(`State read error, using default (disabled): ${err}`);
    }
  }

  // 4. Default: embeddings disabled
  log('State: no state.json found, using default: embeddings disabled');
  return false;
}

/**
 * Gets the absolute path to Node.js binary with hot-reload resilience.
 * 
 * Flow:
 * 1. If process.env.TRUE_MEM_EMBEDDINGS is set → find node path, save to state
 * 2. If process.env undefined (hot-reload) → read from state file
 * 3. If not found → return 'node' (fallback, may fail)
 * 
 * @returns Absolute path to node binary or 'node' as fallback
 */
export function getNodePath(): string {
  const envValue = process.env.TRUE_MEM_EMBEDDINGS;
  
  // 1. If env var is set, find and cache node path
  if (envValue !== undefined) {
    let nodePath: string | null = null;
    
    // Cross-platform: try 'which' on Unix, 'where' on Windows
    try {
      const whichResult = execSync('which node', { encoding: 'utf-8' }).trim();
      nodePath = whichResult || null;
    } catch {
      try {
        // Windows: 'where' returns multiple lines, take first
        const whereResult = execSync('where node', { encoding: 'utf-8' }).trim().split('\n')[0];
        nodePath = whereResult || null;
      } catch {
        nodePath = null;
      }
    }
    
    if (nodePath) {
      log(`State: Node.js path resolved: ${nodePath}`);
      
      // Update state with node path (preserve embeddingsEnabled)
      const existingState = loadState();
      saveState({
        ...existingState,
        nodePath,
        lastEnvCheck: new Date().toISOString()
      });
      
      return nodePath;
    } else {
      log(`State: Failed to resolve node path, using fallback`);
      return 'node'; // Fallback
    }
  }
  
  // 2. Hot-reload: read from state file
  const state = loadState();
  if (state.nodePath) {
    log(`State: Node.js path from state.json: ${state.nodePath}`);
    return state.nodePath;
  }
  
  // 3. Fallback
  log('State: Node.js path not found in state.json, using fallback "node"');
  return 'node';
}

/**
 * Load state from disk
 */
export function loadState(): TrueMemState {
  if (existsSync(STATE_FILE)) {
    try {
      const stateJson = readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(stateJson);
    } catch {
      // Ignore errors
    }
  }
  return { ...DEFAULT_STATE };
}

/**
 * Save state to disk
 */
export function saveState(state: Partial<TrueMemState>): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    const currentState = loadState();
    const newState = { ...currentState, ...state };
    writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
  } catch (err) {
    // Non-critical - log and continue
    log(`State save error: ${err}`);
  }
}
