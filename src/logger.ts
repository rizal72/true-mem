/**
 * True-Memory Logger
 * File-based logging to avoid SDK crashes
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LOG_DIR = join(homedir(), '.true-memory');
const LOG_FILE = join(LOG_DIR, 'plugin-debug.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export function log(message: string, data?: unknown): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

    // Rotate if log exceeds 10 MB
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size >= LOG_MAX_BYTES) {
        renameSync(LOG_FILE, join(LOG_DIR, 'plugin-debug.log.1'));
      }
    } catch { /* ignore */ }

    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    appendFileSync(LOG_FILE, entry);
  } catch {
    // Silently ignore logging errors
  }
}
