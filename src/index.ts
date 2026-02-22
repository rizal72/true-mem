/**
 * True-Memory - Persistent memory plugin for OpenCode
 * 
 * CRITICAL:
 * - Do NOT await in default export (blocks OpenCode startup)
 * - Return hooks IMMEDIATELY, init lazily on first hook call
 */

// SYNC DEBUG - runs at module load time
console.log('[TRUE-MEMORY] Module loading...');

import type { Plugin, Hooks } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';

console.log('[TRUE-MEMORY] Imports done');

import { log } from './logger.js';

console.log('[TRUE-MEMORY] Logger imported');

// Singleton state - shared across all hook calls
let state: {
  initialized: boolean;
  initPromise: Promise<void> | null;
  ctx: PluginInput | null;
  realHooks: Hooks | null;
} = {
  initialized: false,
  initPromise: null,
  ctx: null,
  realHooks: null,
};

// Lazy initialization - called on first hook
async function lazyInit(): Promise<Hooks> {
  if (state.initialized && state.realHooks) {
    return state.realHooks;
  }
  
  if (state.initPromise) {
    await state.initPromise;
    return state.realHooks!;
  }
  
  state.initPromise = (async () => {
    log('Lazy init started');
    
    if (!state.ctx) {
      log('ERROR: No ctx available');
      return;
    }
    
    try {
      // Dynamic import to avoid blocking at module load time
      const { createTrueMemoryPlugin } = await import('./adapters/opencode/index.js');
      state.realHooks = await createTrueMemoryPlugin(state.ctx);
      state.initialized = true;
      log('Lazy init completed');
    } catch (error) {
      log(`Lazy init failed: ${error}`);
    }
  })();
  
  await state.initPromise;
  return state.realHooks || {};
}

const TrueMemory: Plugin = async (ctx) => {
  console.log('[TRUE-MEMORY] Plugin entry point called');
  log('Plugin entry point - returning hooks immediately');
  
  // Store ctx for lazy init
  state.ctx = ctx;
  
  // Return hooks IMMEDIATELY - no await!
  // Real init happens lazily on first hook call
  return {
    event: async ({ event }) => {
      const hooks = await lazyInit();
      if (hooks.event) {
        await hooks.event({ event });
      }
    },
    
    'tool.execute.after': async (input, output) => {
      const hooks = await lazyInit();
      if (hooks['tool.execute.after']) {
        await hooks['tool.execute.after'](input, output);
      }
    },
    
    'experimental.session.compacting': async (input, output) => {
      const hooks = await lazyInit();
      if (hooks['experimental.session.compacting']) {
        await hooks['experimental.session.compacting'](input, output);
      }
    },
  };
};

export default TrueMemory;

// Export types
export type { PsychMemConfig, MemoryUnit, MemoryClassification } from './types.js';
