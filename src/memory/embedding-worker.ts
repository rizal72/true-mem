/**
 * Worker thread for embedding computation
 * Isolates Transformers.js from main thread
 */

import { parentPort, workerData } from 'worker_threads';
import { pipeline, env } from '@huggingface/transformers';

// Configure for stability
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 2;
}
env.cacheDir = process.env.HOME ? `${process.env.HOME}/.true-mem/models` : '~/.true-mem/models';

let extractor: any = null;

async function initialize() {
  try {
    log('Initializing embedding model:', workerData.model);
    extractor = await pipeline('feature-extraction', workerData.model, {
      dtype: 'q8', // Quantized for memory efficiency
      device: 'cpu', // CPU only - avoid WebGPU crashes
    });
    parentPort?.postMessage({ type: 'ready' });
  } catch (error) {
    parentPort?.postMessage({ type: 'error', error: String(error) });
    process.exit(1);
  }
}

parentPort?.on('message', async (msg) => {
  if (msg.type === 'embed') {
    try {
      if (!extractor) {
        throw new Error('Extractor not initialized');
      }

      const embeddings = await extractor(msg.texts, { pooling: 'mean', normalize: true });
      
      // Convert to regular arrays for message passing
      const embeddingsArray = Array.from(embeddings).map((e: any) => Array.from(e));
      parentPort?.postMessage({ type: 'embeddings', embeddings: embeddingsArray });
    } catch (error) {
      parentPort?.postMessage({ type: 'error', error: String(error) });
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  parentPort?.postMessage({ type: 'shutdown' });
  process.exit(0);
});

// Memory monitoring
setInterval(() => {
  const usage = process.memoryUsage();
  if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB cap
    parentPort?.postMessage({ type: 'error', error: 'Memory limit exceeded' });
    process.exit(1);
  }
}, 5000); // Check every 5 seconds

// Simple log function
function log(...args: any[]) {
  console.log('[embedding-worker]', ...args);
}

initialize();
