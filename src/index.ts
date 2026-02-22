/**
 * True-Memory - Persistent memory plugin for OpenCode
 *
 * Entry point (plugin.js style)
 *
 * CRITICAL:
 * - Do NOT use ctx.client.app.log() in default export (causes crash)
 * - Do NOT do heavy init in default export (blocks plugin loading)
 * - Init is lazy, deferred to createTrueMemoryPlugin
 */

import type { Plugin } from '@opencode-ai/plugin';
import { createTrueMemoryPlugin } from './adapters/opencode/index.js';
import { log } from './logger.js';

const TrueMemory: Plugin = async (ctx) => {
  log('Plugin loading started');
  return await createTrueMemoryPlugin(ctx);
};

export default TrueMemory;

// Also export the factory for advanced usage
export { createTrueMemoryPlugin } from './adapters/opencode/index.js';

// Export types
export type { PsychMemConfig, MemoryUnit, MemoryClassification } from './types.js';
