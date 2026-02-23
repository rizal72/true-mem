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
    primary: ['error', 'bug', 'crash', 'exception', 'fail', 'broken', 'issue', 'problem', 'errore', 'guasto', 'fallimento'],
    boosters: ['fixed', 'resolved', 'patched', 'solved', 'corrected', 'repaired', 'debugged', 'risolto', 'corretto', 'sistemato', 'patchato'],
  },
  decision: {
    primary: ['decided', 'chose', 'selected', 'picked', 'opted', 'went with', 'deciso', 'scelto', 'selezionato'],
    boosters: ['because', 'since', 'reason', 'rationale', 'due to', 'as', 'perché', 'poiché', 'motivo', 'ragione'],
  },
  learning: {
    primary: ['learned', 'discovered', 'found out', 'realized', 'figured out', 'imparato', 'scoperto', 'capito'],
    boosters: ['today', 'just', 'finally', 'interesting', 'surprising', 'oggi', 'appena'],
  },
  constraint: {
    primary: ["can't", 'cannot', 'must not', 'never', 'forbidden', 'prohibited', 'not allowed', 'non posso', 'vietato', 'proibito', 'obbligatorio'],
    boosters: ['always', 'require', 'mandatory', 'enforce', 'strict', 'mai', 'necessario'],
  },
  preference: {
    primary: ['prefer', 'like', 'want', 'favor', 'rather', 'preferisco', 'mi piace', 'voglio', 'prediligo'],
    boosters: ['better', 'best', 'instead', 'over', 'more than', 'meglio', 'ottimo', 'invece', 'rispetto a', 'sempre'],
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

/**
 * Classify content with explicit intent detection.
 * If explicit_remember signal is present, isolate the sentence and classify it.
 */
export function classifyWithExplicitIntent(
  text: string,
  signals: any[]
): { classification: string | null; confidence: number } {
  // Check if explicit_remember signal is present
  const hasExplicitRemember = signals.some(s => s.type === 'explicit_remember');

  if (!hasExplicitRemember) {
    // Fall back to normal classification
    const classification = inferClassification(text);
    const confidence = classification ? calculateClassificationScore(text, classification) : 0;
    return { classification, confidence };
  }

  // Extract explicit remember marker patterns
  const markerPatterns = [
    /ricorda questo/gi,
    /remember this/gi,
    /ricorda/gi,
    /remember/gi,
    /tieni a mente/gi,
    /keep in mind/gi,
    /nota che/gi,
    /note that/gi,
  ];

  // Find the sentence containing the explicit marker
  const sentences = text.match(/[^.!?]*[.!?]/g) || [];
  let targetSentence = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (markerPatterns.some(pattern => pattern.test(trimmed))) {
      targetSentence = trimmed;
      break;
    }
  }

  // If no sentence found with marker, classify entire text
  const textToClassify = targetSentence || text;

  // Score ONLY the target sentence for all classifications
  let bestClassification: string | null = null;
  let bestScore = 0;

  for (const [classification] of Object.entries(CLASSIFICATION_KEYWORDS)) {
    const score = calculateClassificationScore(textToClassify, classification);
    if (score > bestScore) {
      bestScore = score;
      bestClassification = classification;
    }
  }

  // Lower threshold for explicit remember (0.4 instead of 0.6)
  if (bestScore >= 0.4 && bestClassification) {
    // Boost confidence to at least 0.85 for explicit remember
    const boostedConfidence = Math.max(0.85, bestScore);
    return { classification: bestClassification, confidence: boostedConfidence };
  }

  // Fall back to normal classification if explicit sentence doesn't match
  const fallbackClassification = inferClassification(text);
  const fallbackConfidence = fallbackClassification ? calculateClassificationScore(text, fallbackClassification) : 0;
  return { classification: fallbackClassification, confidence: fallbackConfidence };
}
