/**
 * True-Memory - Persistent memory plugin for OpenCode
 *
 * CRITICAL:
 * - Do NOT await in default export (blocks OpenCode startup)
 * - Return hooks IMMEDIATELY, init lazily on first hook call
 */

import type { Plugin, Hooks } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { log } from './logger.js';

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
    return state.realHooks || {};
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
      // Reset to allow retry on subsequent calls
      state.initPromise = null;
      state.realHooks = null;
    }
  })();

  await state.initPromise;
  // Return an empty hooks object if initialization failed
  // This prevents TypeError when callers try to access hook properties
  return state.realHooks || {};
}

const TrueMemory: Plugin = async (ctx) => {
  console.log('🧠 True-Memory: Plugin loading...');
  // Store ctx for lazy init
  state.ctx = ctx;

  log('True-Memory: Plugin registered (lazy init mode)');

  // Return hooks IMMEDIATELY - no await!
  // Real init happens lazily on first hook call
  return {
    event: async ({ event }) => {
      // Skip noisy events synchronously
      const silentEvents = new Set(['message.part.delta', 'message.part.updated', 'session.diff']);
      if (silentEvents.has(event.type)) return;

      // Fire-and-forget - don't await!
      lazyInit().then(hooks => {
        if (hooks.event) {
          hooks.event({ event }).catch(err => log(`Event error (${event.type}): ${err}`));
        }
      }).catch(err => log(`Init error: ${err}`));
      // Returns immediately - UI not blocked
    },

    'tool.execute.before': async (input, output) => {
      // MUST await - needs to modify tool arguments before tool execution
      const hooks = await lazyInit();
      if (hooks['tool.execute.before']) {
        await hooks['tool.execute.before'](input, output);
      }
    },

    'tool.execute.after': async (input, output) => {
      // Fire-and-forget - don't await!
      lazyInit().then(hooks => {
        if (hooks['tool.execute.after']) {
          hooks['tool.execute.after'](input, output).catch(err => log(`Tool execute after error: ${err}`));
        }
      }).catch(err => log(`Init error: ${err}`));
      // Returns immediately - UI not blocked
    },

    'experimental.chat.system.transform': async (input, output) => {
      // MUST await - needs to modify output before system prompt is sent
      const hooks = await lazyInit();
      if (hooks['experimental.chat.system.transform']) {
        await hooks['experimental.chat.system.transform'](input, output);
      }
    },

    'experimental.session.compacting': async (input, output) => {
      // MUST await - needs to modify output before compaction
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
