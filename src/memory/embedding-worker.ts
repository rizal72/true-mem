/**
 * Standalone Node.js worker for embedding computation
 * Runs as child process (not worker thread) to avoid Bun/ONNX crashes
 * Uses eval('import()') hack to avoid bun bundling issues
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Local log function that writes to the same log file as the main thread
const LOG_DIR = join(homedir(), '.true-mem');
const LOG_FILE = join(LOG_DIR, 'plugin-debug.log');

function log(message: string, data?: unknown): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [worker] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
    appendFileSync(LOG_FILE, entry);
  } catch {
    // Silently ignore logging errors
  }
}

// FIX: Use dynamic import via eval to avoid bun bundling issues with native .node modules
let pipeline: any;
let env: any;

async function loadTransformers() {
  const { pipeline: p, env: e } = await eval("import('@huggingface/transformers')");
  pipeline = p;
  env = e;
  
  // Configure for stability AFTER loading
  if (env?.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 2;
  }
  env.cacheDir = process.env.HOME ? `${process.env.HOME}/.true-mem/models` : '~/.true-mem/models';
  
  log('Transformers.js configured, cacheDir:', env.cacheDir);
}

let extractor: any = null;
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null; // FIX P1: Track interval

async function initialize() {
  const model = process.env.WORKER_MODEL || 'Xenova/all-MiniLM-L6-v2';
  
  try {
    log('Loading Transformers.js...');
    await loadTransformers();
    log('Transformers.js loaded, initializing model:', model);
    
    extractor = await pipeline('feature-extraction', model, {
      dtype: 'q8', // Quantized for memory efficiency
      device: 'cpu', // CPU only - avoid WebGPU crashes
    });
    
    log('Model loaded successfully');
    process.send?.({ type: 'ready' });
  } catch (error: any) {
    log('Failed to initialize model:', error?.message || error);
    process.send?.({ type: 'error', error: String(error?.message || error) });
    process.exit(1);
  }
}

process.on('message', async (msg: any) => {
  if (msg.type === 'embed') {
    try {
      if (!extractor) {
        throw new Error('Extractor not initialized');
      }

      const embeddings = await extractor(msg.texts, { pooling: 'mean', normalize: true });
      
      // Convert to regular arrays for message passing, include requestId for correlation
      const embeddingsArray = Array.from(embeddings).map((e: any) => Array.from(e));
      process.send?.({ type: 'embeddings', requestId: msg.requestId, embeddings: embeddingsArray });
    } catch (error) {
      process.send?.({ type: 'error', requestId: msg.requestId, error: String(error) });
    }
  }
  
  // FIX CRITICAL: Handle graceful shutdown message from parent
  if (msg.type === 'shutdown') {
    log('Received shutdown message, cleaning up...');
    await gracefulShutdown();
  }
});

// Graceful shutdown
const gracefulShutdown = async () => {
  // FIX P1: Clear interval to prevent leak
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }
  
  // FIX P0: Try to dispose extractor (v4 may support this)
  if (extractor && typeof extractor.dispose === 'function') {
    try {
      await extractor.dispose();
      log('Extractor disposed successfully');
    } catch (err) {
      log('Error disposing extractor:', err);
    }
  }
  
  process.send?.({ type: 'shutdown' });
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
// FIX CRITICAL: Add SIGINT handler for Ctrl+C and force-kill scenarios
process.on('SIGINT', gracefulShutdown);

// Memory monitoring
memoryCheckInterval = setInterval(() => { // FIX P1: Save interval reference
  const usage = process.memoryUsage();
  if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB cap
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);
    
    log(`WARNING: Memory limit exceeded - Heap: ${heapUsedMB}MB / ${heapTotalMB}MB, RSS: ${rssMB}MB`);
    // NOT exiting - we want to observe the behavior instead of crashing
    // process.send?.({ type: 'error', error: 'Memory limit exceeded' });
    // process.exit(1);
  }
}, 5000); // Check every 5 seconds



initialize();
