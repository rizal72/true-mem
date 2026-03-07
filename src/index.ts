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
import { EmbeddingService } from './memory/embeddings-nlp.js';
import { getEmbeddingsEnabled } from './config/state.js';

// Singleton state - shared across all hook calls
let state: {
  initialized: boolean;
  initPromise: Promise<void> | null;
  ctx: PluginInput | null;
  realHooks: Hooks | null;
  initializingLock: boolean;
} = {
  initialized: false,
  initPromise: null,
  ctx: null,
  realHooks: null,
  initializingLock: false,
};

// Track if toast shown (per process, not per session)
let hasShownToast = false;

const TrueMemory: Plugin = async (ctx) => {
  // Store ctx
  state.ctx = ctx;

  // Show toast IMMEDIATELY when plugin loads (works for ALL sessions, including continued)
  // Small delay to let UI settle (OMO-slim toast comes later, after first prompt)
  if (!hasShownToast) {
    hasShownToast = true;
    const version = getVersion();
    setTimeout(() => {
      showToast(ctx, `True-Mem v${version}`, 'Memory active.', 'info', 4000);
    }, 2000);
  }

  // FIX: Detect hot-reload and reset state
  // After hot-reload, state persists but we need fresh initialization
  if (state.initialized || state.initializingLock) {
    const previousState = {
      initialized: state.initialized,
      initializingLock: state.initializingLock,
      hasInitPromise: !!state.initPromise,
      hasRealHooks: !!state.realHooks
    };
    
    log('Hot-reload detected, resetting state', previousState);
    
    state.initialized = false;
    state.initializingLock = false;
    state.initPromise = null;
    state.realHooks = null;
  }

  // Start initialization IMMEDIATELY but DON'T await
  // Use lock to prevent concurrent initialization
  if (!state.initializingLock) {
    state.initializingLock = true;

    state.initPromise = (async () => {
      log('Phase 1: Initializing plugin (lightweight)...');

      if (!state.ctx) {
        log('ERROR: No ctx available');
        state.initializingLock = false;
        return;
      }

      try {
        // Lightweight operations only (database, config)
        const { createTrueMemoryPlugin } = await import('./adapters/opencode/index.js');
        state.realHooks = await createTrueMemoryPlugin(state.ctx);
        state.initialized = true;

        // Initialize NLP embeddings if feature flag is enabled
        const embeddingsEnabled = getEmbeddingsEnabled();
        
        if (embeddingsEnabled) {
          log('Embeddings enabled, initializing...');
          const embeddingService = EmbeddingService.getInstance();
          const initialized = await embeddingService.initialize();
          if (initialized) {
            log('NLP embeddings enabled');
          } else {
            log('NLP embeddings failed to initialize, using Jaccard only');
          }
        } else {
          log('Embeddings disabled');
        }

        log('Phase 1 complete - Plugin ready');
      } catch (error) {
        log(`Init failed: ${error}`);
        // Reset to allow retry on subsequent calls
        state.initPromise = null;
        state.realHooks = null;
      } finally {
        state.initializingLock = false;
      }
    })();
  }

  // Return hooks IMMEDIATELY - no await!
  log('True-Mem: Plugin registered (immediate init mode)');

  return {
    config: async (input) => {
      // No-op - config hook required by OpenCode but not used
    },

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

    'chat.message': async (input, output) => {
      if (!state.initialized && state.initPromise) {
        await state.initPromise;
      }

      if (state.realHooks?.['chat.message']) {
        await state.realHooks['chat.message'](input, output);
      }
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
