/**
 * Memory Classifier with Three-Layer Defense
 *
 * Layer 1: Negative Patterns (filter out known false positives)
 * Layer 2: Multi-Keyword Scoring (require 2+ signals)
 * Layer 3: Confidence Threshold (store only if score >= 0.6)
 */

import { matchesNegativePattern } from './negative-patterns.js';

// Classification keywords for multi-keyword scoring
const CLASSIFICATION_KEYWORDS: Record<string, { primary: string[]; boosters: string[] }> = {
  bugfix: {
    primary: ['error', 'bug', 'crash', 'exception', 'fail', 'broken', 'issue', 'problem'],
    boosters: ['fixed', 'resolved', 'patched', 'solved', 'corrected', 'repaired', 'debugged'],
  },
  decision: {
    primary: ['decided', 'chose', 'selected', 'picked', 'opted', 'went with'],
    boosters: ['because', 'since', 'reason', 'rationale', 'due to', 'as'],
  },
  learning: {
    primary: ['learned', 'discovered', 'found out', 'realized', 'figured out'],
    boosters: ['today', 'just', 'finally', 'interesting', 'surprising'],
  },
  constraint: {
    primary: ["can't", 'cannot', 'must not', 'never', 'forbidden', 'prohibited', 'not allowed'],
    boosters: ['always', 'require', 'mandatory', 'enforce', 'strict'],
  },
  preference: {
    primary: ['prefer', 'like', 'want', 'favor', 'rather'],
    boosters: ['better', 'best', 'instead', 'over', 'more than'],
  },
  procedural: {
    primary: ['step', 'workflow', 'process', 'procedure', 'instructions', 'guide'],
    boosters: ['first', 'then', 'next', 'finally', 'after', 'before'],
  },
};

// Confidence threshold for storing memories
export const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Calculate classification score based on keyword presence
 * Returns 0-1 score where higher is more confident
 */
export function calculateClassificationScore(text: string, classification: string): number {
  const keywords = CLASSIFICATION_KEYWORDS[classification];
  if (!keywords) return 0;

  const textLower = text.toLowerCase();
  const { primary, boosters } = keywords;

  const primaryMatches = primary.filter(k => textLower.includes(k.toLowerCase())).length;
  const boosterMatches = boosters.filter(k => textLower.includes(k.toLowerCase())).length;

  // No primary keywords = not this classification
  if (primaryMatches === 0) return 0;

  // Single primary, no boosters = low confidence (likely false positive)
  if (primaryMatches === 1 && boosterMatches === 0) return 0.4;

  // Calculate score
  // More primaries and boosters = higher confidence
  const primaryScore = Math.min(0.5, primaryMatches * 0.2);
  const boosterScore = Math.min(0.3, boosterMatches * 0.15);

  return Math.min(1, 0.3 + primaryScore + boosterScore);
}

/**
 * Three-layer defense: decide if memory should be stored
 */
export function shouldStoreMemory(
  text: string,
  classification: string,
  baseSignalScore: number
): { store: boolean; confidence: number; reason: string } {
  // Layer 1: Check negative patterns
  if (matchesNegativePattern(text, classification)) {
    return {
      store: false,
      confidence: 0,
      reason: 'matches_negative_pattern',
    };
  }

  // Layer 2: Calculate multi-keyword score
  const keywordScore = calculateClassificationScore(text, classification);

  // No keywords found for this classification
  if (keywordScore === 0) {
    return {
      store: false,
      confidence: 0,
      reason: 'no_classification_keywords',
    };
  }

  // Layer 3: Combined score must exceed threshold
  const finalScore = (baseSignalScore + keywordScore) / 2;

  if (finalScore < CONFIDENCE_THRESHOLD) {
    return {
      store: false,
      confidence: finalScore,
      reason: 'below_confidence_threshold',
    };
  }

  return {
    store: true,
    confidence: finalScore,
    reason: 'passed_all_layers',
  };
}

/**
 * Infer classification from text content
 * Returns the most likely classification or null
 */
export function inferClassification(text: string): string | null {
  const textLower = text.toLowerCase();
  let bestClassification: string | null = null;
  let bestScore = 0;

  for (const [classification, keywords] of Object.entries(CLASSIFICATION_KEYWORDS)) {
    const score = calculateClassificationScore(text, classification);
    if (score > bestScore) {
      bestScore = score;
      bestClassification = classification;
    }
  }

  return bestScore >= 0.4 ? bestClassification : null;
}
