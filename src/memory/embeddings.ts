/**
 * True-Mem Embeddings (Hybrid: Jaccard + Transformers.js)
 * Jaccard similarity as baseline, optional NLP embeddings via Transformers.js
 */

import { log } from '../logger.js';
import { EmbeddingService } from './embeddings-nlp.js';

// =============================================================================
// Jaccard Similarity (Always Available)
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

// =============================================================================
// Hybrid Similarity (Jaccard + NLP Embeddings)
// =============================================================================

/**
 * Calculate hybrid similarity between two texts
 * Uses Jaccard as baseline, blends with NLP embeddings if available
 *
 * @param text1 - First text
 * @param text2 - Second text
 * @returns number - Hybrid similarity (0 to 1)
 */
export async function getSimilarity(text1: string, text2: string): Promise<number> {
  // Fast path: Jaccard for exact keyword matches
  const jaccardScore = jaccardSimilarity(text1, text2);

  // If high confidence from Jaccard, return immediately
  if (jaccardScore > 0.7) {
    log(`Similarity: Jaccard fast path (${jaccardScore.toFixed(3)} > 0.7)`);
    return jaccardScore;
  }

  // Semantic path: Use embeddings if available
  const embeddingService = EmbeddingService.getInstance();
  
  if (!embeddingService.isEnabled()) {
    // Fallback: Jaccard only
    log(`Similarity: Jaccard only (${jaccardScore.toFixed(3)}, embeddings disabled)`);
    return jaccardScore;
  }

  try {
    const embeddings = await embeddingService.getEmbeddings([text1, text2]);

    if (embeddings && embeddings.length === 2 && embeddings[0] && embeddings[1]) {
      const cosineScore = cosineSimilarityArrays(embeddings[0], embeddings[1]);
      const blendedScore = (jaccardScore * 0.3) + (cosineScore * 0.7);
      // Blend Jaccard and cosine (weighted average)
      log(`Similarity: HYBRID - Jaccard: ${jaccardScore.toFixed(3)}, Cosine: ${cosineScore.toFixed(3)}, Blended: ${blendedScore.toFixed(3)}`);
      return blendedScore;
    }
  } catch (error) {
    log('Hybrid similarity failed, falling back to Jaccard:', error);
  }

  // Fallback: Jaccard only
  log(`Similarity: Jaccard fallback (${jaccardScore.toFixed(3)})`);
  return jaccardScore;
}

/**
 * Calculate cosine similarity between two vectors (arrays)
 */
function cosineSimilarityArrays(vec1: number[], vec2: number[]): number {
  if (!vec1 || !vec2 || vec1.length === 0 || vec2.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    const v1 = vec1[i] ?? 0;
    const v2 = vec2[i] ?? 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}
