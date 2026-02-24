/**
 * True-Mem Shutdown Manager
 * Synchronous shutdown mechanism to prevent Bun crashes
 * 
 * CRITICAL: No signal handlers - Bun handles cleanup automatically
 * Custom signal handlers cause C++ exceptions during shutdown
 */

import { log } from './logger.js';

// =============================================================================
// Shutdown Handler Definition
// =============================================================================

export interface ShutdownHandler {
  name: string;
  handler: () => void | Promise<void>;
}

// =============================================================================
// Shutdown Manager Singleton
// =============================================================================

class ShutdownManager {
  private static instance: ShutdownManager;
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  private constructor() {
    // NO signal handlers - they cause Bun C++ exceptions
    // Bun handles process cleanup automatically
    log('Shutdown manager: Initialized (no signal handlers)');
  }

  public static getInstance(): ShutdownManager {
    if (!ShutdownManager.instance) {
      ShutdownManager.instance = new ShutdownManager();
    }
    return ShutdownManager.instance;
  }

  /**
   * Register a shutdown handler
   * Handlers are executed in reverse registration order (LIFO)
   */
  public registerHandler(name: string, handler: () => void | Promise<void>): void {
    if (this.isShuttingDown) {
      log(`Shutdown warning: Cannot register handler "${name}" during shutdown`);
      return;
    }

    const shutdownHandler: ShutdownHandler = { name, handler };
    this.handlers.push(shutdownHandler);
    log(`Shutdown handler registered: ${name} (total: ${this.handlers.length})`);
  }

  /**
   * Execute all registered shutdown handlers SYNCHRONOUSLY
   * Called only from server.instance.disposed - never from signal handlers
   */
  public executeShutdown(reason: string): void {
    if (this.isShuttingDown) {
      log(`Shutdown already in progress (${reason}), skipping`);
      return;
    }

    this.isShuttingDown = true;
    log(`Starting shutdown: ${reason}`);

    // Execute handlers in reverse order (LIFO) - SYNCHRONOUSLY
    const reversedHandlers = [...this.handlers].reverse();

    for (const { name, handler } of reversedHandlers) {
      try {
        log(`Executing shutdown handler: ${name}`);
        const result = handler();
        // If handler returns a promise, ignore it - don't await
        if (result instanceof Promise) {
          result.catch(() => {}); // Swallow async errors
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Shutdown handler error: ${name} - ${errorMessage}`);
        // Continue with other handlers
      }
    }

    log('Shutdown completed');
    // DON'T reset isShuttingDown - we're shutting down
  }

  /**
   * Get the list of registered handlers (for debugging)
   */
  public getHandlers(): ReadonlyArray<ShutdownHandler> {
    return [...this.handlers];
  }

  /**
   * Check if shutdown is in progress
   */
  public isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Register a shutdown handler
 * @param name - Handler name for logging
 * @param handler - Sync cleanup function (async promises are ignored)
 */
export function registerShutdownHandler(name: string, handler: () => void | Promise<void>): void {
  const manager = ShutdownManager.getInstance();
  manager.registerHandler(name, handler);
}

/**
 * Execute shutdown sequence manually - SYNCHRONOUS
 * @param reason - Reason for shutdown (for logging)
 */
export function executeShutdown(reason: string): void {
  const manager = ShutdownManager.getInstance();
  manager.executeShutdown(reason);
}

/**
 * Get registered shutdown handlers (for debugging)
 */
export function getShutdownHandlers(): ReadonlyArray<ShutdownHandler> {
  const manager = ShutdownManager.getInstance();
  return manager.getHandlers();
}

/**
 * Check if shutdown is in progress
 */
export function isShutdownInProgress(): boolean {
  const manager = ShutdownManager.getInstance();
  return manager.isShutdownInProgress();
}

// Initialize shutdown manager on module load
ShutdownManager.getInstance();
