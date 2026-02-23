/**
 * True-Memory Reconsolidation Module
 * Handles memory deduplication, conflict resolution, and complement detection
 * Designed for future LLM-based conflict resolution
 */

import type { MemoryUnit } from '../types.js';
import type { MemoryDatabase } from '../storage/database.js';

/**
 * Reconsolidation action result
 */
export type ReconsolidationAction =
  | { type: 'duplicate'; updatedMemory: MemoryUnit }
  | { type: 'conflict'; replacementMemory: MemoryUnit }
  | { type: 'complement'; newMemory: MemoryUnit };

/**
 * Similarity thresholds for reconsolidation decisions
 */
const SIMILARITY_THRESHOLDS = {
  DUPLICATE: 0.95,
  CONFLICT: 0.8,
  MIN_RELEVANT: 0.7,
} as const;

/**
 * Handle memory reconsolidation based on similarity
 *
 * This function determines how to handle a new memory compared to an existing one:
 * - similarity > 0.95: Duplicate (increment frequency, update timestamp)
 * - similarity > 0.8: Conflict (newer wins - replace existing)
 * - otherwise: Complement (store as new memory)
 *
 * @param db - The database instance
 * @param newMemoryData - The new memory to potentially store
 * @param existingMemory - The existing similar memory found
 * @param similarity - The calculated similarity score (0-1)
 * @returns A ReconsolidationAction indicating what to do
 */
export async function handleReconsolidation(
  db: MemoryDatabase,
  newMemoryData: Partial<MemoryUnit> & {
    summary: string;
    classification: MemoryUnit['classification'];
    sourceEventIds: string[];
    store: MemoryUnit['store'];
  },
  existingMemory: MemoryUnit,
  similarity: number
): Promise<ReconsolidationAction> {
  if (similarity > SIMILARITY_THRESHOLDS.DUPLICATE) {
    // Duplicate: Increment frequency and update timestamp
    return await handleDuplicate(db, newMemoryData, existingMemory);
  } else if (similarity > SIMILARITY_THRESHOLDS.CONFLICT) {
    // Conflict: Newer wins strategy
    return await handleConflict(db, newMemoryData, existingMemory);
  } else {
    // Complement: Store as new memory
    return { type: 'complement', newMemory: newMemoryData as MemoryUnit };
  }
}

/**
 * Handle duplicate memory (similarity > 0.95)
 * Increments frequency and updates timestamp of existing memory
 *
 * @param db - The database instance
 * @param newMemoryData - The new memory data (will not be stored)
 * @param existingMemory - The existing memory to update
 * @returns Duplicate action with updated memory
 */
async function handleDuplicate(
  db: MemoryDatabase,
  newMemoryData: Partial<MemoryUnit> & {
    summary: string;
    classification: MemoryUnit['classification'];
    sourceEventIds: string[];
    store: MemoryUnit['store'];
  },
  existingMemory: MemoryUnit
): Promise<{ type: 'duplicate'; updatedMemory: MemoryUnit }> {
  // Increment frequency and update timestamps
  db.incrementFrequency(existingMemory.id);

  // Update last_accessed_at to now
  const now = new Date().toISOString();
  db['db'].prepare(`UPDATE memory_units SET last_accessed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, existingMemory.id);

  // Get updated memory
  const updatedMemory = db.getMemory(existingMemory.id)!;

  return { type: 'duplicate', updatedMemory };
}

/**
 * Handle conflicting memory (similarity > 0.8)
 * Uses "newer wins" strategy: delete existing, prepare new memory
 *
 * @param db - The database instance
 * @param newMemoryData - The new memory data to replace existing
 * @param existingMemory - The existing memory to delete
 * @returns Conflict action with replacement memory
 */
async function handleConflict(
  db: MemoryDatabase,
  newMemoryData: Partial<MemoryUnit> & {
    summary: string;
    classification: MemoryUnit['classification'];
    sourceEventIds: string[];
    store: MemoryUnit['store'];
  },
  existingMemory: MemoryUnit
): Promise<{ type: 'conflict'; replacementMemory: MemoryUnit }> {
  // Delete existing memory
  db['db'].prepare(`DELETE FROM memory_units WHERE id = ?`).run(existingMemory.id);

  // Return new memory to be stored
  // Note: The caller is responsible for actually storing this memory
  return { type: 'conflict', replacementMemory: newMemoryData as MemoryUnit };
}

/**
 * Check if similarity is above minimum relevance threshold
 *
 * @param similarity - The similarity score
 * @returns True if similarity >= 0.7
 */
export function isRelevant(similarity: number): boolean {
  return similarity >= SIMILARITY_THRESHOLDS.MIN_RELEVANT;
}

/**
 * Get similarity thresholds for configuration or debugging
 */
export function getSimilarityThresholds() {
  return { ...SIMILARITY_THRESHOLDS };
}
