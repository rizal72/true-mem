/**
 * True-Memory Embeddings (Stub - Jaccard Similarity)
 * Replaced Transformers.js with Jaccard similarity (word overlap)
 */

import { log } from '../logger.js';

// =============================================================================
// Stub Functions (No Vector Embeddings)
// =============================================================================

/**
 * Calculate Jaccard similarity between two texts
 * Jaccard = |intersection| / |union|
 *
 * @param text1 - First text
 * @param text2 - Second text
 * @returns number - Jaccard similarity (0 to 1)
 */
export function jaccardSimilarity(text1: string, text2: string): number {
  try {
    // Tokenize into lowercase words (remove punctuation)
    const tokenize = (text: string): Set<string> => {
      const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 0);
      return new Set(words);
    };

    const set1 = tokenize(text1);
    const set2 = tokenize(text2);

    if (set1.size === 0 || set2.size === 0) {
      return 0;
    }

    // Calculate intersection and union
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    const similarity = intersection.size / union.size;

    log('Jaccard similarity calculated', {
      similarity: similarity.toFixed(4),
      text1Words: set1.size,
      text2Words: set2.size,
      intersectionWords: intersection.size,
    });

    return similarity;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Jaccard similarity calculation failed', { error: errorMessage });
    return 0;
  }
}

/**
 * Stub: Generate embedding (not used - returns empty array)
 * @deprecated Use jaccardSimilarity instead
 */
export async function embed(text: string): Promise<Float32Array> {
  log('Embeddings: embed() called, returning empty array (use jaccardSimilarity instead)');
  return new Float32Array(0);
}

/**
 * Stub: Dispose function (no-op)
 * @deprecated No resources to clean up
 */
export function disposeEmbeddings(): void {
  log('Embeddings: disposeEmbeddings() called (no-op in Jaccard mode)');
}

/**
 * Stub: Get embedding pipeline (not used)
 * @deprecated Use jaccardSimilarity instead
 */
export function getEmbeddingPipeline(): any {
  log('Embeddings: getEmbeddingPipeline() called (no-op in Jaccard mode)');
  return null;
}

// =============================================================================
// Legacy functions (for backward compatibility, do not use)
// =============================================================================

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function vectorToBuffer(vector: Float32Array): Buffer {
  log('Warning: vectorToBuffer called (no-op in Jaccard mode)');
  return Buffer.alloc(0);
}

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function bufferToVector(buffer: Buffer): Float32Array {
  log('Warning: bufferToVector called (no-op in Jaccard mode)');
  return new Float32Array(0);
}

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  log('Warning: cosineSimilarity called (no-op in Jaccard mode, returning 0)');
  return 0;
}
