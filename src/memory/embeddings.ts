/**
 * True-Memory Embeddings
 * Vector embeddings using Transformers.js (local, private, free)
 */

import { log } from '../logger';

// =============================================================================
// Singleton Embedding Pipeline
// =============================================================================

class EmbeddingPipeline {
  private static instance: EmbeddingPipeline | null = null;
  private pipeline: any = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    log('Embeddings: Singleton created (lazy loading mode)');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): EmbeddingPipeline {
    if (!EmbeddingPipeline.instance) {
      EmbeddingPipeline.instance = new EmbeddingPipeline();
    }
    return EmbeddingPipeline.instance;
  }

  /**
   * Initialize the embedding pipeline (lazy loading)
   * Only called when embed() is invoked for the first time
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        log('Embeddings: Loading model Xenova/all-MiniLM-L6-v2...');

        // Use eval for dynamic import to bypass bun build's static analysis and name mangling
        const transformers = await eval('import("@huggingface/transformers")');
        log('Embeddings: Transformers keys:', Object.keys(transformers).slice(0, 20));

        const pipeline = transformers.pipeline;
        const env = transformers.env;

        if (!pipeline) {
          log('Embeddings: ERROR - pipeline not found in transformers object');
          throw new Error('pipeline function not found in transformers module');
        }
        log('Embeddings: pipeline found in transformers object');

        log('Embeddings: env present:', !!env);

        this.pipeline = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          {
            progress_callback: (progress: any) => {
              if (progress.status === 'progress') {
                const percent = progress.progress ? Math.round(progress.progress * 100) : 0;
                if (percent % 20 === 0) { // Log every 20%
                  log(`Embeddings: Model download progress: ${percent}%`);
                }
              }
            },
          }
        );

        this.isInitialized = true;
        log('Embeddings: Model loaded successfully (Xenova/all-MiniLM-L6-v2)');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('Embeddings: Failed to load model', { error: errorMessage });
        this.initializationPromise = null;
        throw new Error(`Failed to initialize embedding pipeline: ${errorMessage}`);
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Generate embedding for a text
   * @param text - Input text to embed
   * @returns Promise<Float32Array> - Embedding vector
   */
  public async embed(text: string): Promise<Float32Array> {
    try {
      // Lazy initialization - only load model when first needed
      await this.initialize();

      if (!this.pipeline) {
        throw new Error('Embedding pipeline not initialized');
      }

      log('Embeddings: Generating embedding for text', { textLength: text.length });

      // Generate embeddings using the pipeline
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract the tensor data as Float32Array
      const embedding = Array.isArray(output) && typeof output[0] === 'number'
        ? new Float32Array(output as number[])
        : (output as { data: Float32Array }).data;

      log('Embeddings: Embedding generated successfully', {
        dimensions: embedding.length,
      });

      // Reset idle timer after successful embedding
      this.resetIdleTimer();

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('Embeddings: Failed to generate embedding', { error: errorMessage });
      throw new Error(`Embedding generation failed: ${errorMessage}`);
    }
  }

  /**
   * Dispose of the embedding pipeline to free memory
   * Should be called when the plugin is shutting down
   */
  public async dispose(): Promise<void> {
    try {
      // Clear the idle timer
      if (this.disposeTimer) {
        clearTimeout(this.disposeTimer);
        this.disposeTimer = null;
      }

      if (this.pipeline) {
        // Transformers.js pipelines may have a dispose method for proper cleanup
        if (typeof this.pipeline.dispose === 'function') {
          log('Embeddings: Calling pipeline.dispose()');
          await this.pipeline.dispose();
        }

        // Clear the reference and let garbage collection handle it
        this.pipeline = null;
        this.isInitialized = false;
        this.initializationPromise = null;
        log('Embeddings: Pipeline disposed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('Embeddings: Error during dispose', { error: errorMessage });
    }
  }

  /**
   * Check if the pipeline is initialized
   */
  public isReady(): boolean {
    return this.isInitialized && this.pipeline !== null;
  }

  /**
   * Reset the idle timer for automatic disposal
   * Called after each successful embedding operation
   */
  private resetIdleTimer(): void {
    // Clear existing timer
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
    }

    // Set new timer to dispose after idle timeout
    this.disposeTimer = setTimeout(async () => {
      log('Embeddings: Idle timeout reached, disposing pipeline');
      await this.dispose();
    }, this.IDLE_TIMEOUT_MS);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert a Float32Array vector to a Buffer for SQLite storage
 * @param vector - Float32Array to convert
 * @returns Buffer - Binary representation of the vector
 */
export function vectorToBuffer(vector: Float32Array): Buffer {
  try {
    const buffer = Buffer.alloc(vector.length * 4); // 4 bytes per float32
    const view = new Float32Array(buffer.buffer);
    view.set(vector);
    log('Embeddings: Vector converted to Buffer', {
      dimensions: vector.length,
      size: buffer.length,
    });
    return buffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Embeddings: Failed to convert vector to Buffer', { error: errorMessage });
    throw new Error(`Vector to Buffer conversion failed: ${errorMessage}`);
  }
}

/**
 * Convert a Buffer back to a Float32Array
 * @param buffer - Buffer containing the vector data
 * @returns Float32Array - Restored vector
 */
export function bufferToVector(buffer: Buffer): Float32Array {
  try {
    if (buffer.length % 4 !== 0) {
      throw new Error(`Invalid buffer length: ${buffer.length} (must be multiple of 4)`);
    }
    const vector = new Float32Array(buffer.buffer);
    log('Embeddings: Buffer converted to Float32Array', {
      dimensions: vector.length,
    });
    return vector;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Embeddings: Failed to convert Buffer to vector', { error: errorMessage });
    throw new Error(`Buffer to Vector conversion failed: ${errorMessage}`);
  }
}

/**
 * Calculate cosine similarity between two vectors
 * @param a - First vector
 * @param b - Second vector
 * @returns number - Cosine similarity (-1 to 1, but typically 0 to 1 for normalized vectors)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  try {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    if (a.length === 0) {
      throw new Error('Cannot compute similarity of empty vectors');
    }

    // Compute dot product
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i]!;
      const bi = b[i]!;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    // Handle zero vectors
    if (normA === 0 || normB === 0) {
      log('Embeddings: Cosine similarity warning - zero vector detected');
      return 0;
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

    log('Embeddings: Cosine similarity calculated', {
      similarity: similarity.toFixed(4),
      dimensions: a.length,
    });

    // Clamp to [-1, 1] to handle floating point errors
    return Math.max(-1, Math.min(1, similarity));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Embeddings: Failed to calculate cosine similarity', { error: errorMessage });
    throw new Error(`Cosine similarity calculation failed: ${errorMessage}`);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the singleton embedding pipeline instance
 */
export function getEmbeddingPipeline(): EmbeddingPipeline {
  return EmbeddingPipeline.getInstance();
}

/**
 * Generate an embedding for text (convenience function)
 * @param text - Input text
 * @returns Promise<Float32Array> - Embedding vector
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipeline = getEmbeddingPipeline();
  return pipeline.embed(text);
}

/**
 * Dispose of the embedding pipeline (convenience function)
 */
export async function disposeEmbeddings(): Promise<void> {
  const pipeline = getEmbeddingPipeline();
  await pipeline.dispose();
}
