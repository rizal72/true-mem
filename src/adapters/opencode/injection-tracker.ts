/**
 * Injection Tracker
 * Tracks which sessions have received memory injection
 */

import { log } from '../../logger.js';

// Track injected sessions (sessionId → injected)
const injectedSessions = new Map<string, boolean>();

// Track session creation order (for debugging)
const sessionOrder: string[] = [];

// Max sessions to track (prevent memory leak)
const MAX_TRACKED_SESSIONS = 100;

/**
 * Mark session as created (called on session.created event)
 */
export function markSessionCreated(sessionId: string): void {
  // Cleanup old sessions if limit reached
  if (sessionOrder.length >= MAX_TRACKED_SESSIONS) {
    const oldestSession = sessionOrder.shift();
    if (oldestSession) {
      injectedSessions.delete(oldestSession);
      log(`Cleanup: removed old session ${oldestSession}`);
    }
  }
  
  sessionOrder.push(sessionId);
  injectedSessions.set(sessionId, false);
  log(`Session created: ${sessionId.slice(0, 8)}... (total: ${sessionOrder.length})`);
}

/**
 * Check if session has been injected
 */
export function hasInjected(sessionId: string): boolean {
  return injectedSessions.get(sessionId) === true;
}

/**
 * Mark session as injected
 */
export function markInjected(sessionId: string): void {
  injectedSessions.set(sessionId, true);
  log(`Session injected: ${sessionId.slice(0, 8)}...`);
}

/**
 * Check if session exists in tracker
 */
export function isSessionTracked(sessionId: string): boolean {
  return injectedSessions.has(sessionId);
}

/**
 * Ensure session is tracked (creates if not exists)
 */
export function ensureSessionTracked(sessionId: string): void {
  if (!injectedSessions.has(sessionId)) {
    markSessionCreated(sessionId);
  }
}

/**
 * Clear tracking for ended sessions
 */
export function clearSession(sessionId: string): void {
  injectedSessions.delete(sessionId);
  const index = sessionOrder.indexOf(sessionId);
  if (index > -1) {
    sessionOrder.splice(index, 1);
  }
  log(`Session cleared: ${sessionId.slice(0, 8)}...`);
}

/**
 * Get stats for debugging
 */
export function getTrackerStats(): {
  totalSessions: number;
  injectedCount: number;
  pendingCount: number;
} {
  let injected = 0;
  let pending = 0;
  
  for (const status of injectedSessions.values()) {
    if (status) injected++;
    else pending++;
  }
  
  return {
    totalSessions: injectedSessions.size,
    injectedCount: injected,
    pendingCount: pending,
  };
}
