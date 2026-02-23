/**
 * Extraction Queue - Sequential processing of memory extraction jobs
 */

import { log } from '../logger.js';

export interface ExtractionJob {
  execute: () => Promise<void>;
  description?: string;
}

export class ExtractionQueue {
  private queue: ExtractionJob[] = [];
  private isProcessing: boolean = false;

  /**
   * Add a job to the queue
   * Non-blocking - returns immediately
   */
  add(job: ExtractionJob): void {
    this.queue.push(job);
    log(`Queue: Added job${job.description ? ` (${job.description})` : ''}, queue size: ${this.queue.length}`);
    this.processQueue();
  }

  /**
   * Process the queue sequentially
   * Uses queueMicrotask for non-blocking execution
   */
  private processQueue(): void {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    queueMicrotask(() => this.runNextJob());
  }

  /**
   * Run the next job in the queue
   */
  private async runNextJob(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift();

    if (!job) {
      this.isProcessing = false;
      return;
    }

    try {
      log(`Queue: Processing job${job.description ? ` (${job.description})` : ''}`);
      await job.execute();
      log(`Queue: Job completed successfully`);
    } catch (error) {
      log(`Queue: Job error - ${error}`);
      // Continue processing next jobs despite errors
    }

    // Schedule next job
    queueMicrotask(() => this.runNextJob());
  }

  /**
   * Get current queue size (for debugging)
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is currently processing
   */
  get processing(): boolean {
    return this.isProcessing;
  }
}

// Singleton instance
let queueInstance: ExtractionQueue | null = null;

export function getExtractionQueue(): ExtractionQueue {
  if (!queueInstance) {
    queueInstance = new ExtractionQueue();
    log('ExtractionQueue: Singleton instance created');
  }
  return queueInstance;
}
