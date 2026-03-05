/**
 * Worker thread for embedding computation
 * Isolates Transformers.js from main thread
 * Uses eval('import()') hack to avoid bun bundling issues
 */

import { parentPort, workerData } from 'worker_threads';

// FIX: Use dynamic import via eval to avoid bun bundling issues with native .node modules
let pipeline: any;
let env: any;

async function loadTransformers() {
  const { pipeline: p, env: e } = await eval("import('@huggingface/transformers')");
  pipeline = p;
  env = e;
}

// Configure for stability
if (env?.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 2;
}
env.cacheDir = process.env.HOME ? `${process.env.HOME}/.true-mem/models` : '~/.true-mem/models';

let extractor: any = null;
let memoryCheckInterval: ReturnType<typeof setInterval> | null = null; // FIX P1: Track interval

async function initialize() {
  try {
    log('Loading Transformers.js...');
    await loadTransformers();
    log('Transformers.js loaded, initializing model:', workerData.model);
    
    extractor = await pipeline('feature-extraction', workerData.model, {
      dtype: 'q8', // Quantized for memory efficiency
      device: 'cpu', // CPU only - avoid WebGPU crashes
    });
    
    log('Model loaded successfully');
    parentPort?.postMessage({ type: 'ready' });
  } catch (error: any) {
    log('Failed to initialize model:', error?.message || error);
    parentPort?.postMessage({ type: 'error', error: String(error?.message || error) });
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
process.on('SIGTERM', async () => {
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
  
  parentPort?.postMessage({ type: 'shutdown' });
  process.exit(0);
});

// Memory monitoring
memoryCheckInterval = setInterval(() => { // FIX P1: Save interval reference
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
