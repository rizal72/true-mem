/**
 * True-Memory Atomic Injection
 * XML-based memory injection with persona boundary support
 */

import type { MemoryUnit } from '../../types.js';
import { jaccardSimilarity } from '../../memory/embeddings.js';
import { USER_LEVEL_CLASSIFICATIONS } from '../../types.js';

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
