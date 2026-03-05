/**
 * True-Mem Atomic Injection
 * XML-based memory injection with persona boundary support
 */

import type { MemoryUnit } from '../../types.js';
import type { MemoryDatabase } from '../../storage/database.js';
import { jaccardSimilarity } from '../../memory/embeddings.js';
import { USER_LEVEL_CLASSIFICATIONS } from '../../types.js';
import { log } from '../../logger.js';

/**
 * Adapter state interface for injection operations
 */
export interface InjectionState {
  db: {
    vectorSearch: (queryText: string, currentProject?: string, limit?: number) => Promise<MemoryUnit[]>;
    getMemoriesByScope: (currentProject?: string, limit?: number) => MemoryUnit[];
  };
  worktree: string;
}

/**
 * Injection type determines the XML structure
 */
export type InjectionType = 'user' | 'project' | 'global';

/**
 * Wrap memories in XML format with persona boundary
 *
 * @param memories - Array of memory units to inject
 * @param worktree - Current project worktree path
 * @param type - Injection type (user, project, or global)
 * @returns XML-formatted string with memories
 */
export function wrapMemories(
  memories: MemoryUnit[],
  worktree: string,
  type: InjectionType = 'global'
): string {
  const lines: string[] = [
    `<true_memory_context type="${type}" worktree="${worktree}">`,
  ];

  // Add persona boundary to enforce user preferences
  const userMemories = memories.filter(m => USER_LEVEL_CLASSIFICATIONS.includes(m.classification));
  if (userMemories.length > 0) {
    lines.push('  <persona_boundary>');
    for (const mem of userMemories) {
      const storeLabel = mem.store === 'ltm' ? 'LTM' : 'STM';
      lines.push(`    <memory classification="${mem.classification}" store="${storeLabel}" strength="${mem.strength.toFixed(2)}">`);
      lines.push(`      ${escapeXml(mem.summary)}`);
      lines.push('    </memory>');
    }
    lines.push('  </persona_boundary>');
    lines.push('');
  }

  // Add project-level memories
  const projectMemories = memories.filter(m => !USER_LEVEL_CLASSIFICATIONS.includes(m.classification));
  if (projectMemories.length > 0) {
    lines.push('  <memories>');
    for (const mem of projectMemories) {
      const storeLabel = mem.store === 'ltm' ? 'LTM' : 'STM';
      lines.push(`    <memory classification="${mem.classification}" store="${storeLabel}" strength="${mem.strength.toFixed(2)}">`);
      lines.push(`      ${escapeXml(mem.summary)}`);
      lines.push('    </memory>');
    }
    lines.push('  </memories>');
  }

  lines.push('</true_memory_context>');

  return lines.join('\n');
}

/**
 * Retrieve relevant memories with optional query-based Jaccard similarity search
 *
 * @param state - Adapter state containing database connection
 * @param query - Optional query string for Jaccard similarity search
 * @param limit - Maximum number of memories to retrieve (default: 8)
 * @returns Array of relevant memory units
 */
export async function getAtomicMemories(
  state: InjectionState,
  query?: string,
  limit: number = 8
): Promise<MemoryUnit[]> {
  if (query && query.trim().length > 0) {
    // Use Jaccard similarity search (text-based, no embeddings)
    return state.db.vectorSearch(query, state.worktree, limit);
  } else {
    // Fall back to scope-based retrieval
    return state.db.getMemoriesByScope(state.worktree, limit);
  }
}

/**
 * Escape XML special characters to prevent injection attacks
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Extract user preferences from memories for persona boundary
 *
 * @param memories - Array of memory units
 * @returns Array of preference and constraint memories
 */
export function extractUserPreferences(memories: MemoryUnit[]): MemoryUnit[] {
  return memories.filter(m =>
    USER_LEVEL_CLASSIFICATIONS.includes(m.classification)
  );
}

/**
 * Extract project context from memories
 *
 * @param memories - Array of memory units
 * @returns Array of project-level memories
 */
export function extractProjectContext(memories: MemoryUnit[]): MemoryUnit[] {
  return memories.filter(m =>
    !USER_LEVEL_CLASSIFICATIONS.includes(m.classification)
  );
}

/**
 * Select memories for injection using dynamic allocation with scope quotas
 * 
 * Strategy (values scale proportionally to maxMemories):
 * - Min 30% GLOBAL (preferences, constraints, learning, procedural)
 * - Min 30% PROJECT (decisions, semantic, episodic)
 * - Max 40% flexible (context-relevant from either scope)
 * 
 * Classification Priority:
 * Tier 0: constraint (capped at 10, critical rules)
 * Tier 1: preference, decision (high priority, by strength)
 * Tier 2: learning, procedural (medium priority, by strength)
 * Tier 3: semantic, episodic (low priority, by query relevance)
 */
export async function selectMemoriesForInjection(
  db: MemoryDatabase,
  worktree: string,
  queryContext: string,
  embeddingsEnabled: boolean,
  maxMemories: number = 20,
  maxTokens: number = 4000
): Promise<MemoryUnit[]> {
  const memories: MemoryUnit[] = [];
  let totalTokens = 0;
  
  // Scale quotas proportionally
  const MIN_GLOBAL = Math.floor(maxMemories * 0.3);
  const MIN_PROJECT = Math.floor(maxMemories * 0.3);
  const MAX_FLEXIBLE = maxMemories - MIN_GLOBAL - MIN_PROJECT;
  const MAX_CONSTRAINTS = 10;
  
  // Step 1: Get all memories
  const allMemories = db.getMemoriesByScope(worktree, 100);
  
  // Early return for small pools
  if (allMemories.length <= maxMemories) {
    log(`Small memory pool: returning all ${allMemories.length} memories`);
    return allMemories;
  }
  
  const globalMemories = allMemories.filter(m => m.projectScope === null);
  const projectMemories = allMemories.filter(m => m.projectScope !== null);
  
  // Helper: Estimate tokens (1 token ≈ 4 chars)
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
  
  // Helper: Add memory if within budget
  const addMemory = (memory: MemoryUnit): boolean => {
    const tokens = estimateTokens(memory.summary);
    if (totalTokens + tokens > maxTokens) {
      log(`Token budget exceeded, skipping memory ${memory.id}`);
      return false;
    }
    memories.push(memory);
    totalTokens += tokens;
    return true;
  };
  
  // Step 2: Tier 0 - Constraints (capped)
  const constraints = allMemories
    .filter(m => m.classification === 'constraint')
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_CONSTRAINTS);
  
  for (const constraint of constraints) {
    if (!addMemory(constraint)) break;
  }
  
  // Step 3: Scope quotas
  const globalHigh = globalMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_GLOBAL);
  
  for (const memory of globalHigh) {
    if (!addMemory(memory)) break;
  }
  
  const projectHigh = projectMemories
    .filter(m => !memories.find(existing => existing.id === m.id))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MIN_PROJECT);
  
  for (const memory of projectHigh) {
    if (!addMemory(memory)) break;
  }
  
  // Step 4: Flexible slots
  const remainingSlots = maxMemories - memories.length;
  
  if (remainingSlots > 0 && embeddingsEnabled && queryContext.trim().length > 0) {
    const relevant = await db.vectorSearch(queryContext, worktree, MAX_FLEXIBLE);
    const existingIds = new Set(memories.map(m => m.id));
    const newMemories = relevant.filter(m => !existingIds.has(m.id));
    
    for (const memory of newMemories.slice(0, remainingSlots)) {
      if (!addMemory(memory)) break;
    }
    
    log(`Dynamic selection: ${memories.length} memories [max=${maxMemories}, tokens=${totalTokens}]`);
  } else if (remainingSlots > 0) {
    const remaining = allMemories
      .filter(m => !memories.find(existing => existing.id === m.id))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, remainingSlots);
    
    for (const memory of remaining) {
      if (!addMemory(memory)) break;
    }
    
    log(`Fallback selection: ${memories.length} memories [max=${maxMemories}, tokens=${totalTokens}]`);
  }
  
  return memories;
}
