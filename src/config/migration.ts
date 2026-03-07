/**
 * Configuration Migration
 * 
 * One-time migration from old config.json to new config/state separation:
 * - Old config.json → state.json (runtime state: embeddingsEnabled, nodePath, lastEnvCheck)
 * - New config.json → user configuration (injectionMode, subagentMode, maxMemories)
 * 
 * Migration is idempotent - safe to run multiple times.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../logger.js';
import { DEFAULT_USER_CONFIG, DEFAULT_STATE } from '../types/config.js';

const CONFIG_DIR = join(homedir(), '.true-mem');
const OLD_CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const STATE_FILE = join(CONFIG_DIR, 'state.json');
const NEW_CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Migration status marker file
 */
const MIGRATION_DONE_FILE = join(CONFIG_DIR, '.migrated');

/**
 * Run migration if needed (idempotent)
 * 
 * Migration steps:
 * 1. If .migrated marker exists → already migrated, skip
 * 2. If old config.json exists → migrate to state.json
 * 3. Create new config.json with defaults
 * 4. Create .migrated marker
 */
export function migrateIfNeeded(): void {
  // 1. Check if already migrated (fast path)
  if (existsSync(MIGRATION_DONE_FILE)) {
    log('Migration: already completed, skipping');
    return;
  }

  log('Migration: starting config/state separation...');

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // 2. Migrate old config.json to state.json if it exists
  if (existsSync(OLD_CONFIG_FILE)) {
    try {
      const oldContent = JSON.parse(readFileSync(OLD_CONFIG_FILE, 'utf-8'));
      
      log(`Migration: found old config.json, migrating to state.json`);
      
      // Extract runtime state from old config
      const state = {
        embeddingsEnabled: oldContent.embeddingsEnabled ?? DEFAULT_STATE.embeddingsEnabled,
        lastEnvCheck: oldContent.lastEnvCheck ?? DEFAULT_STATE.lastEnvCheck,
        nodePath: oldContent.nodePath ?? DEFAULT_STATE.nodePath,
      };
      
      // Write state.json
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      log(`Migration: state.json created with embeddingsEnabled=${state.embeddingsEnabled}`);
      
      // Extract user config from old config (M1: preserve user custom values)
      const userConfig = {
        injectionMode: oldContent.injectionMode ?? DEFAULT_USER_CONFIG.injectionMode,
        subagentMode: oldContent.subagentMode ?? DEFAULT_USER_CONFIG.subagentMode,
        maxMemories: oldContent.maxMemories ?? DEFAULT_USER_CONFIG.maxMemories,
      };
      
      // Atomic write: write to temp file first, then rename (M2: atomic operation)
      const tempFile = `${NEW_CONFIG_FILE}.tmp`;
      writeFileSync(tempFile, JSON.stringify(userConfig, null, 2));
      renameSync(tempFile, NEW_CONFIG_FILE);
      log(`Migration: new config.json created with user settings (atomic)`);
      
      // Delete old config.json AFTER new one is created
      unlinkSync(OLD_CONFIG_FILE);
      log('Migration: old config.json deleted');
    } catch (err) {
      log(`Migration: error migrating old config: ${err}`);
    }
  }

  // 3. Create new config.json with defaults (if not exists) - atomic write
  if (!existsSync(NEW_CONFIG_FILE)) {
    const tempFile = `${NEW_CONFIG_FILE}.tmp`;
    writeFileSync(tempFile, JSON.stringify(DEFAULT_USER_CONFIG, null, 2));
    renameSync(tempFile, NEW_CONFIG_FILE);
    log('Migration: new config.json created with defaults');
  } else {
    log('Migration: config.json already exists, preserving user settings');
  }

  // 4. Create migration marker
  writeFileSync(MIGRATION_DONE_FILE, JSON.stringify({
    version: '1.3.0',
    migratedAt: new Date().toISOString()
  }, null, 2));

  log('Migration: completed successfully');
}

/**
 * Force migration (for testing/recovery)
 * Removes marker and re-runs migration
 */
export function forceMigration(): void {
  if (existsSync(MIGRATION_DONE_FILE)) {
    unlinkSync(MIGRATION_DONE_FILE);
  }
  migrateIfNeeded();
}
