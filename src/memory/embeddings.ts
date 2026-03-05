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

    // Log removed - use jaccardSimilarityBatch() for logging
    return similarity;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('Jaccard similarity calculation failed', { error: errorMessage });
    return 0;
  }
}

/**
 * Calculate Jaccard similarity for a batch of text pairs with aggregated logging
 * Use this instead of jaccardSimilarity when you want concise logs
 *
 * @param pairs - Array of {text1, text2} pairs
 * @returns Array of similarity scores
 */
export function jaccardSimilarityBatch(pairs: { text1: string; text2: string }[]): number[] {
  if (pairs.length === 0) return [];

  const results: number[] = [];
  const tokenize = (text: string): Set<string> => {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 0);
    return new Set(words);
  };

  for (const { text1, text2 } of pairs) {
    try {
      const set1 = tokenize(text1);
      const set2 = tokenize(text2);

      if (set1.size === 0 || set2.size === 0) {
        results.push(0);
        continue;
      }

      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      results.push(intersection.size / union.size);
    } catch {
      results.push(0);
    }
  }

  // Log aggregated statistics
  if (results.length > 0) {
    const min = Math.min(...results);
    const max = Math.max(...results);
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    log(`Jaccard: ${results.length} calcs, range: ${min.toFixed(3)}-${max.toFixed(3)}, avg: ${avg.toFixed(3)}`);
  }

  return results;
}

/**
 * Stub: Generate embedding (not used - returns empty array)
 * @deprecated Use jaccardSimilarity instead
 */
export async function embed(text: string): Promise<Float32Array> {
  return new Float32Array(0);
}

/**
 * Stub: Dispose function (no-op)
 * @deprecated No resources to clean up
 */
export function disposeEmbeddings(): void {
  // No-op in Jaccard mode
}

/**
 * Stub: Get embedding pipeline (not used)
 * @deprecated Use jaccardSimilarity instead
 */
export function getEmbeddingPipeline(): any {
  return null;
}

// =============================================================================
// Legacy functions (for backward compatibility, do not use)
// =============================================================================

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.alloc(0);
}

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function bufferToVector(buffer: Buffer): Float32Array {
  return new Float32Array(0);
}

/**
 * @deprecated Use jaccardSimilarity instead
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

  // If high confidence from Jaccard, return immediately (no log - too verbose)
  if (jaccardScore > 0.7) {
    return jaccardScore;
  }

  // Semantic path: Use embeddings if available
  const embeddingService = EmbeddingService.getInstance();
  
  if (!embeddingService.isEnabled()) {
    // Fallback: Jaccard only (no log - too verbose)
    return jaccardScore;
  }

  try {
    const embeddings = await embeddingService.getEmbeddings([text1, text2]);

    if (embeddings && embeddings.length === 2 && embeddings[0] && embeddings[1]) {
      const cosineScore = cosineSimilarityArrays(embeddings[0], embeddings[1]);
      const blendedScore = (jaccardScore * 0.3) + (cosineScore * 0.7);
      // Log removed - use getSimilarityBatch() for aggregated logging
      return blendedScore;
    }
  } catch (error) {
    log('Hybrid similarity failed, falling back to Jaccard:', error);
  }

  return jaccardScore;
}

/**
 * Calculate hybrid similarity for a batch of text pairs with aggregated logging
 * Use this instead of getSimilarity when processing multiple memories
 *
 * @param pairs - Array of {text1, text2} pairs
 * @returns Array of hybrid similarity scores
 */
export async function getSimilarityBatch(pairs: { text1: string; text2: string }[]): Promise<number[]> {
  if (pairs.length === 0) return [];

  const embeddingService = EmbeddingService.getInstance();
  const embeddingsEnabled = embeddingService.isEnabled();

  // First pass: calculate all Jaccard similarities
  const jaccardResults = jaccardSimilarityBatch(pairs);

  // If embeddings disabled, return Jaccard only
  if (!embeddingsEnabled) {
    return jaccardResults;
  }

  // Second pass: get embeddings and calculate hybrid scores
  const results: number[] = [];
  let hasEmbeddings = false;

  try {
    // Extract all unique texts for embedding
    const allTexts = pairs.map(p => p.text1);
    const allMemoryTexts = pairs.map(p => p.text2);
    
    const queryEmbeddings = await embeddingService.getEmbeddings(allTexts);
    const memoryEmbeddings = await embeddingService.getEmbeddings(allMemoryTexts);

    if (queryEmbeddings && memoryEmbeddings && 
        queryEmbeddings.length === allTexts.length && 
        memoryEmbeddings.length === allMemoryTexts.length) {
      hasEmbeddings = true;

      for (let i = 0; i < pairs.length; i++) {
        const qe = queryEmbeddings[i];
        const me = memoryEmbeddings[i];
        const jaccardScore = jaccardResults[i] ?? 0;
        if (qe && me) {
          const cosineScore = cosineSimilarityArrays(qe, me);
          const blendedScore = (jaccardScore * 0.3) + (cosineScore * 0.7);
          results.push(blendedScore);
        } else {
          results.push(jaccardScore);
        }
      }
    }
  } catch (error) {
    log('Batch hybrid similarity failed, using Jaccard only:', error);
  }

  // If embeddings failed, fall back to Jaccard
  if (!hasEmbeddings) {
    return jaccardResults;
  }

  // Log aggregated hybrid statistics
  if (results.length > 0) {
    const min = Math.min(...results);
    const max = Math.max(...results);
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    log(`Hybrid: ${results.length} calcs, range: ${min.toFixed(3)}-${max.toFixed(3)}, avg: ${avg.toFixed(3)}`);
  }

  return results;
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
