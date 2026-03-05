/**
 * True-Mem Hybrid NLP Embeddings Service
 * Uses Transformers.js v4 with worker thread isolation
 * Graceful degradation to Jaccard similarity
 */

import { Worker } from 'worker_threads';
import { log } from '../logger.js';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export class EmbeddingService {
  private static instance: EmbeddingService;
  private worker: Worker | null = null;
  private enabled = false;
  private failureCount = 0;
  private lastFailure = 0;
  private ready = false;
  private readyResolve: ((value: boolean) => void) | null = null;
  private readyPromise: Promise<boolean> | null = null;

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
    // Check feature flag
    if (!process.env.TRUE_MEM_EMBEDDINGS) {
      log('NLP embeddings disabled (TRUE_MEM_EMBEDDINGS not set)');
      return false;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      log('NLP embeddings circuit breaker open, skipping');
      return false;
    }

    try {
      // FIX P0: Create promise BEFORE spawning worker (race condition)
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
      });

      // Create worker thread for embeddings
      // FIX: Use import.meta.url to resolve correct path in bundled environment
      const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
      const workerPath = path.join(currentDir, 'embedding-worker.js');
      
      log('Spawning worker at path:', workerPath);
      
      this.worker = new Worker(workerPath, {
        workerData: { model: 'Xenova/all-MiniLM-L6-v2' }
      });

      // Handle worker messages
      this.worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          log('Embedding worker ready');
          this.ready = true;
          if (this.readyResolve) {
            this.readyResolve(true);
          }
        } else if (msg.type === 'error') {
          log('Embedding worker error:', msg.error);
          this.recordFailure();
        }
      });

      // Handle worker errors
      this.worker.on('error', (err: any) => {
        log('Embedding worker error:', err?.message || err?.toString() || String(err));
        log('Error stack:', err?.stack);
        this.recordFailure();
        this.cleanup();
      });

      // Handle worker exit
      this.worker.on('exit', (code, signal) => {
        log(`Embedding worker exited with code ${code}, signal: ${signal}`);
        if (code !== 0) {
          this.recordFailure();
        }
        this.ready = false;
      });

      // Wait for worker to be ready (max 30 seconds)
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          log('Embedding worker initialization timeout');
          resolve(false);
        }, 30000);
      });

      const workerReady = await Promise.race([this.readyPromise, timeoutPromise]);
      
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

    try {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          // FIX P1: Remove handler on timeout to prevent leak
          this.worker?.off('message', messageHandler);
          reject(new Error('Embedding timeout'));
        }, 5000); // 5 second timeout

        const messageHandler = (msg: any) => {
          if (msg.type === 'embeddings') {
            clearTimeout(timeout);
            this.worker?.off('message', messageHandler);
            resolve(msg.embeddings);
          } else if (msg.type === 'error') {
            clearTimeout(timeout);
            this.worker?.off('message', messageHandler);
            this.recordFailure();
            reject(new Error(msg.error));
          }
        };

        this.worker!.on('message', messageHandler);
        this.worker!.postMessage({ type: 'embed', texts });
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
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.enabled = false;
    this.ready = false;
    this.readyResolve = null;
    this.readyPromise = null;
  }
}
