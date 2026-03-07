/**
 * True-Mem Hybrid NLP Embeddings Service
 * Uses Transformers.js v4 with Node.js child process isolation
 * Graceful degradation to Jaccard similarity
 */

import { spawn, ChildProcess } from 'child_process';
import { log } from '../logger.js';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';

// Worker message types
interface WorkerMessage {
  type: 'embeddings' | 'error' | 'ready' | 'log' | 'shutdown';
  requestId?: string;
  embeddings?: number[][];
  error?: string;
  message?: string;
}

// Resolve worker path from package root (bundler-agnostic)
function resolveWorkerPath(): string {
  const bundleDir = path.dirname(url.fileURLToPath(import.meta.url));
  
  // Walk up to find package.json
  let current = bundleDir;
  const maxDepth = 10;
  let depth = 0;
  
  while (current !== '/' && depth < maxDepth) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      // Found package root, now build worker path
      const workerPath = path.join(current, 'dist', 'memory', 'embedding-worker.js');
      
      if (!fs.existsSync(workerPath)) {
        throw new Error(`Worker file not found at: ${workerPath}`);
      }
      
      return workerPath;
    }
    current = path.dirname(current);
    depth++;
  }
  
  throw new Error('Could not resolve worker path: package root not found');
}

export class EmbeddingService {
  private static instance: EmbeddingService;
  private worker: ChildProcess | null = null;
  private enabled = false;
  private failureCount = 0;
  private lastFailure = 0;
  private ready = false;
  private readyResolve: ((value: boolean) => void) | null = null;
  private readyPromise: Promise<boolean> | null = null;

  // Single listener pattern: Map of pending requests with their resolve/reject callbacks
  private pendingRequests = new Map<string, { resolve: (value: number[][]) => void; reject: (reason?: any) => void; timeout: ReturnType<typeof setTimeout> }>();

  // Debounce: prevent multiple rapid initialization attempts
  private pendingInit: ReturnType<typeof setTimeout> | null = null;
  private initResolve: ((value: boolean) => void) | null = null;

  // Circuit breaker: disable after 3 failures in 5 minutes
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_WINDOW = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(): Promise<boolean> {
    // DEFENSIVE: Verify embeddings should be enabled
    // This prevents accidental initialization if called directly
    const { getEmbeddingsEnabled, getNodePath } = await import('../config/state.js');
    if (!getEmbeddingsEnabled()) {
      log('DEFENSIVE: initialize() called but embeddings disabled - aborting');
      return false;
    }

    // Check circuit breaker BEFORE reset (prevents thrashing)
    if (this.isCircuitBreakerOpen()) {
      log('NLP embeddings circuit breaker open, skipping initialization');
      return false;
    }

    // Cancel any pending initialization (debounce)
    if (this.pendingInit) {
      clearTimeout(this.pendingInit);
      this.pendingInit = null;
    }

    // Create promise that will resolve after debounce completes
    // FIX: Resolve previous promise before creating new one to prevent orphan promises
    if (this.initResolve) {
      this.initResolve(false);
    }
    this.initResolve = null;
    const debouncePromise = new Promise<boolean>((resolve) => {
      this.initResolve = resolve;
    });

    // Schedule initialization after 1 second debounce
    this.pendingInit = setTimeout(async () => {
      this.pendingInit = null;
      const result = await this._doInitialize(getNodePath);
      if (this.initResolve) {
        this.initResolve(result);
        this.initResolve = null;
      }
    }, 1000);

    // Wait for debounced initialization to complete
    return debouncePromise;
  }

  private async _doInitialize(getNodePath: () => string): Promise<boolean> {
    // Reset circuit breaker for fresh attempt
    this.failureCount = 0;
    this.lastFailure = 0;

    try {
      // CRITICAL: Kill any existing worker before spawning new one
      if (this.worker && !this.worker.killed) {
        log('Killing stale worker before spawning new one');
        this.worker.kill('SIGKILL');
        this.worker = null;
      }
      
      // Create promise BEFORE spawning worker (race condition)
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });

      // Create Node.js child process for embeddings
      const workerPath = resolveWorkerPath();
      
      // Validate worker file exists before spawning
      if (!fs.existsSync(workerPath)) {
        log(`Worker file not found at: ${workerPath}. Run 'bun run build' first.`);
        return false;
      }
      
      log('Spawning Node.js worker at path:', workerPath);
      
      // Get Node.js path (hot-reload resilient)
      const nodePath = getNodePath();
      
      // Use Node.js instead of Bun Worker for ONNX stability
      this.worker = spawn(nodePath, [workerPath], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          WORKER_MODEL: 'Xenova/all-MiniLM-L6-v2'
        }
      });

      // Handle messages from worker via IPC
      this.worker.on('message', (msg: any) => {
        const m = msg as WorkerMessage;
        
        if (m.type === 'embeddings' && m.requestId) {
          // Handle embedding response
          const pending = this.pendingRequests.get(m.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(m.requestId);
            pending.resolve(m.embeddings!);
          }
        } else if (m.type === 'error' && m.requestId) {
          // Handle error response for specific request
          const pending = this.pendingRequests.get(m.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(m.requestId);
            this.recordFailure();
            pending.reject(new Error(m.error));
          }
        } else if (m.type === 'ready' && !this.ready) {
          // MEDIUM: Guard against multiple 'ready' messages
          log('Embedding worker ready');
          this.ready = true;
          if (this.readyResolve) {
            this.readyResolve(true);
            this.readyResolve = null; // Prevent multiple calls
          }
        } else if (m.type === 'error' && !m.requestId) {
          // Handle worker-level errors (not specific to a request)
          log('Embedding worker error:', m.error);
          this.recordFailure();
        } else if (m.type === 'log') {
          // Forward worker logs to file (avoid TUI pollution)
          log(m.message || '');
        }
      });

      // Handle worker errors (includes spawn failures like Node.js not found)
      this.worker.on('error', (err: any) => {
        // Check if Node.js is not available
        if (err.code === 'ENOENT' || err.errno === -2 || (err.message && err.message.includes('ENOENT'))) {
          log('Node.js not available - NLP embeddings disabled. Please install Node.js to enable embeddings.');
        } else {
          log(`Worker ERROR: ${err?.message || err?.toString() || String(err)}, stack: ${err?.stack || 'N/A'}`);
        }
        this.recordFailure();
        this.cleanup();
      });

      // Handle worker exit
      this.worker.on('exit', (code, signal) => {
        log(`Worker EXIT: code=${code}, signal=${signal}, killed=${this.worker?.killed}`);
        
        // HIGH: Clean up pending requests on worker exit
        for (const [requestId, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Worker exited unexpectedly'));
        }
        this.pendingRequests.clear();
        
        if (code !== 0) {
          this.recordFailure();
        }
        this.ready = false;
      });

      // Handle stderr for debugging
      this.worker.stderr?.on('data', (data) => {
        log('Worker stderr:', data.toString());
      });

      // Wait for worker to be ready (max 30 seconds)
      let timeoutCancelled = false;
      let initTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<boolean>((resolve) => {
        initTimeout = setTimeout(() => {
          if (!timeoutCancelled) {
            log('Embedding worker initialization timeout');
            resolve(false);
          }
        }, 30000);
      });

      const workerReady = await Promise.race([this.readyPromise, timeoutPromise]);
      
      // CRITICAL: Cancel timeout promise if worker became ready before timeout
      timeoutCancelled = true;
      if (initTimeout) {
        clearTimeout(initTimeout);
        initTimeout = null;
      }
      
      if (workerReady) {
        this.enabled = true;
        log('NLP embeddings initialized successfully');
        return true;
      } else {
        log('NLP embeddings failed to initialize worker');
        this.cleanup();
        return false;
      }

    } catch (error) {
      log('Failed to initialize NLP embeddings:', error);
      this.recordFailure();
      return false;
    }
  }

  async getEmbeddings(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled || !this.worker || !this.ready) {
      return null;
    }

    // FIX: Guard against killed worker
    if (this.worker.killed) {
      log('Worker is killed, cannot get embeddings');
      this.enabled = false;
      this.ready = false;
      return null;
    }

    try {
      const requestId = crypto.randomUUID();
      
      return new Promise((resolve, reject) => {
        // Set timeout for this request
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error('Embedding request timeout'));
        }, 5000); // 5 second timeout

        // Store pending request with resolve/reject callbacks
        this.pendingRequests.set(requestId, { resolve, reject, timeout });

        // FIX: Wrap send in try-catch to prevent crash on dead worker
        try {
          this.worker!.send({ type: 'embed', requestId, texts });
        } catch (sendError) {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          log('Failed to send to worker:', sendError);
          this.recordFailure();
          resolve(null); // Resolve with null instead of rejecting
        }
      });
    } catch (error) {
      log('Embedding computation failed:', error);
      this.recordFailure();
      return null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private isCircuitBreakerOpen(): boolean {
    if (this.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const timeSinceLastFailure = Date.now() - this.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_WINDOW) {
        return true;
      }
      // Reset after window
      this.failureCount = 0;
    }
    return false;
  }

  // CRITICAL: Check if Node.js is available before spawning
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailure = Date.now();
    log(`Embedding failure recorded (${this.failureCount}/${this.CIRCUIT_BREAKER_THRESHOLD})`);

    if (this.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      log('Circuit breaker opened - disabling NLP embeddings');
      this.enabled = false;
      this.ready = false;
    }
  }

  cleanup(): void {
    // Clear all pending requests to prevent memory leaks
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Service cleanup'));
    }
    this.pendingRequests.clear();

    if (this.worker) {
      // Save reference BEFORE nulling (fixes race condition)
      const workerRef = this.worker;
      
      // Send shutdown message to worker
      try {
        this.worker.send({ type: 'shutdown' });
        
        // CRITICAL: Use setTimeout instead of busy-wait to avoid blocking event loop
        // Wait for worker to exit gracefully (max 2 seconds)
        setTimeout(() => {
          if (workerRef && !workerRef.killed) {
            log('Worker did not exit gracefully, forcing kill');
            workerRef.kill('SIGTERM');
          }
        }, 2000);
      } catch (err) {
        log('Error during worker cleanup:', err);
        // Force kill on error
        try {
          workerRef.kill('SIGKILL');
        } catch {}
      }
      this.worker = null;
    }
    this.enabled = false;
    this.ready = false;
    this.readyResolve = null;
    this.readyPromise = null;
  }
}
