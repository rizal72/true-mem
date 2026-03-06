/**
 * True-Mem Logger
 * File-based logging to avoid SDK crashes
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LOG_DIR = join(homedir(), '.true-mem');
const LOG_FILE = join(LOG_DIR, 'plugin-debug.log');
const LOG_MAX_BYTES = 1024 * 1024; // 1 MB

export function log(message: string, data?: unknown): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

    // Rotate if log exceeds 1 MB
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size >= LOG_MAX_BYTES) {
        renameSync(LOG_FILE, LOG_FILE + '.1');
        log('Log rotated (size exceeded 1MB)'); // Log rotation after new file created
      }
    } catch { /* ignore */ }

    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    appendFileSync(LOG_FILE, entry);
  } catch {
    // Silently ignore logging errors
  }
}
