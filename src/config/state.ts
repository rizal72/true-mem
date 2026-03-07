/**
 * Runtime State Management
 * 
 * Persists runtime state to state.json for hot-reload resilience.
 * This is NOT user configuration - it's internal plugin state.
 * 
 * OpenCode plugin hot-reload creates isolated context without env var inheritance.
 * This module bridges the gap by persisting env var values to state file.
 * 
 * Priority: process.env → state file → false (default)
 * 
 * State file: ~/.true-mem/state.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { log } from '../logger.js';
import type { TrueMemState } from '../types/config.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const STATE_FILE = join(CONFIG_DIR, 'state.json');

const DEFAULT_STATE: TrueMemState = {
  embeddingsEnabled: false,
  lastEnvCheck: null,
  nodePath: null,
};

/**
 * Reads embeddings feature flag with hot-reload resilience.
 * 
 * Flow:
 * 1. If process.env.TRUE_MEM_EMBEDDINGS is set → use it, save to state
 * 2. If process.env undefined (hot-reload) → read from state file
 * 3. If no state → default to false
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

  // 2. process.env undefined → we're in hot-reload, read from state file
  log('State: env var undefined (hot-reload), reading from state.json');
  
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

  // 3. Default: embeddings disabled
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
    try {
      const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
      log(`State: Node.js path resolved: ${nodePath}`);
      
      // Update state with node path (preserve embeddingsEnabled)
      const existingState = loadState();
      saveState({
        ...existingState,
        nodePath,
        lastEnvCheck: new Date().toISOString()
      });
      
      return nodePath;
    } catch (err) {
      log(`State: Failed to resolve node path: ${err}`);
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
