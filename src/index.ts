/**
 * True-Mem - Persistent memory plugin for OpenCode
 *
 * CRITICAL:
 * - Initialize immediately but DON'T await in default export
 * - Store initPromise for hooks to await if necessary
 * - Phase 1: Lightweight init (< 50ms) - database, config only
 * - Transformers.js removed, so no Phase 2 needed
 */

import type { Plugin, Hooks } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { log } from './logger.js';
import { getVersion } from './utils/version.js';
import { showToast } from './utils/toast.js';

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

// Track if toast shown (per process, not per session)
let hasShownToast = false;

const TrueMemory: Plugin = async (ctx) => {
  // Store ctx
  state.ctx = ctx;

  // Show toast IMMEDIATELY when plugin loads (works for ALL sessions, including continued)
  // OpenCode TUI only supports ONE toast at a time, so delay 3s to let OMO-slim finish
  if (!hasShownToast) {
    hasShownToast = true;
    const version = getVersion();
    setTimeout(() => {
      showToast(ctx, `True-Mem v${version}`, 'Memory active.', 'info', 4000);
    }, 3000);
  }

  // Start initialization IMMEDIATELY but DON'T await
  state.initPromise = (async () => {
    log('Phase 1: Initializing plugin (lightweight)...');

    if (!state.ctx) {
      log('ERROR: No ctx available');
      return;
    }

    try {
      // Lightweight operations only (database, config)
      const { createTrueMemoryPlugin } = await import('./adapters/opencode/index.js');
      state.realHooks = await createTrueMemoryPlugin(state.ctx);
      state.initialized = true;

      log('Phase 1 complete - Plugin ready');
    } catch (error) {
      log(`Init failed: ${error}`);
      // Reset to allow retry on subsequent calls
      state.initPromise = null;
      state.realHooks = null;
    }
  })();

  // Return hooks IMMEDIATELY - no await!
  log('True-Mem: Plugin registered (immediate init mode)');

  return {
    event: async ({ event }) => {
      // Skip noisy events synchronously
      const silentEvents = new Set(['message.part.delta', 'message.part.updated', 'session.diff']);
      if (silentEvents.has(event.type)) return;

      // Fire-and-forget for event hook
      (async () => {
        if (!state.initialized && state.initPromise) {
          await state.initPromise;
        }

        if (state.realHooks?.event) {
          await state.realHooks.event({ event });
        }
      })().catch(err => log(`Event error (${event.type}): ${err}`));
      // Returns immediately - UI not blocked
    },

    'tool.execute.before': async (input, output) => {
      // Wait for init if needed (but init is very fast without Transformers.js)
      if (!state.initialized && state.initPromise) {
        await state.initPromise;
      }

      if (state.realHooks?.['tool.execute.before']) {
        await state.realHooks['tool.execute.before'](input, output);
      }
    },

    'tool.execute.after': async (input, output) => {
      // Fire-and-forget for after hook
      (async () => {
        if (!state.initialized && state.initPromise) {
          await state.initPromise;
        }

        if (state.realHooks?.['tool.execute.after']) {
          await state.realHooks['tool.execute.after'](input, output);
        }
      })().catch(err => log(`Tool execute after error: ${err}`));
      // Returns immediately - UI not blocked
    },

    'experimental.chat.system.transform': async (input, output) => {
      if (!state.initialized && state.initPromise) {
        await state.initPromise;
      }

      if (state.realHooks?.['experimental.chat.system.transform']) {
        await state.realHooks['experimental.chat.system.transform'](input, output);
      }
    },

    'experimental.session.compacting': async (input, output) => {
      if (!state.initialized && state.initPromise) {
        await state.initPromise;
      }

      if (state.realHooks?.['experimental.session.compacting']) {
        await state.realHooks['experimental.session.compacting'](input, output);
      }
    },
  };
};

export default TrueMemory;

// Export types
export type { PsychMemConfig, MemoryUnit, MemoryClassification } from './types.js';
