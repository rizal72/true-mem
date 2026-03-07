/**
 * Injection Tracker
 * Tracks which sessions have received memory injection
 */

import { log } from '../../logger.js';
import type { PluginInput } from '../../types.js';

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

/**
 * Check if a resumed session already has memory context injected
 * Returns false if memory context is already present (skip injection)
 * Returns true if no memory context found (should inject)
 */
export async function shouldInjectResumedSession(
  client: PluginInput['client'],
  sessionId: string
): Promise<boolean> {
  const TIMEOUT_MS = 3000;
  const MAX_MESSAGES_TO_CHECK = 10;
  
  try {
    // M1: Add timeout wrapper (3 seconds) for API call
    const response = await Promise.race([
      client.session.messages({ path: { id: sessionId } }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('API timeout')), TIMEOUT_MS)
      )
    ]) as Awaited<ReturnType<typeof client.session.messages>>;
    
    // M4: Add validation that response.data is an array
    const responseData = (response as { data?: unknown }).data;
    if (!responseData || !Array.isArray(responseData)) {
      log('Invalid response from session.messages API');
      return true; // Safe default: inject
    }
    
    // M2: Only check first N messages (memory context is at session start)
    const messagesToCheck = responseData.slice(0, MAX_MESSAGES_TO_CHECK);
    
    // M3: Improve tag detection with regex pattern that checks both opening and closing tags
    const MEMORY_CONTEXT_PATTERN = /<true_memory_context[^>]*>[\s\S]*?<\/true_memory_context>/;
    
    for (const msg of messagesToCheck) {
      for (const part of msg.parts) {
        if (part.type === 'text' && 'text' in part) {
          const text = (part as { text: string }).text;
          if (MEMORY_CONTEXT_PATTERN.test(text)) {
            log(`Resumed session already has memory context`);
            return false;
          }
        }
      }
    }
    
    // No memory context found, should inject
    return true;
  } catch (error) {
    log(`Failed to check resumed session: ${error}`);
    return true; // Safe default: inject
  }
}
