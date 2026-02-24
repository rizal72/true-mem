/**
 * Memory Classifier with Three-Layer Defense + Role Awareness
 *
 * Layer 1: Negative Patterns (filter out known false positives)
 * Layer 2: Multi-Keyword Scoring (require 2+ signals)
 * Layer 3: Confidence Threshold (store only if score >= 0.6)
 * Layer 4: Role Validation (Human-only for preferences, constraints, decisions, learnings)
 */

import { matchesNegativePattern } from './negative-patterns.js';
import { log } from '../logger.js';
import type { MessageRole, RoleAwareContext } from '../types.js';
import { HUMAN_MESSAGE_WEIGHT_MULTIPLIER } from '../types.js';
import {
  scoreHumanIntent,
  hasAssistantListPattern,
} from './role-patterns.js';

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
 * 
 * SPECIAL CASE: When classification is 'semantic' (assigned by explicit intent fallback),
 * bypass keyword checking - the user explicitly asked to remember this.
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

  // SPECIAL CASE: semantic classification from explicit intent
  // Bypass keyword checking - user explicitly said "Ricordati che..."
  if (classification === 'semantic') {
    // Use high confidence for explicit intent memories
    return {
      store: true,
      confidence: 0.85,
      reason: 'explicit_intent_semantic',
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
): { classification: string | null; confidence: number; isolatedContent: string } {
  // Check if explicit_remember signal is present
  const hasExplicitRemember = signals.some(s => s.type === 'explicit_remember');

  if (hasExplicitRemember) {
    log('Debug: Explicit intent signal found, isolating sentence...');
  }

  if (!hasExplicitRemember) {
    // Fall back to normal classification
    const classification = inferClassification(text);
    const confidence = classification ? calculateClassificationScore(text, classification) : 0;
    return { classification, confidence, isolatedContent: text };
  }

  // Extract explicit remember marker patterns with word boundaries and optional colon/whitespace
  const markerPatterns = [
    /\bricorda questo\b:?\s*/gi,
    /\bremember this\b:?\s*/gi,
    /\bricordati che\b:?\s*/gi,
    /\bricorda che\b:?\s*/gi,
    /\bmemorizza questo\b:?\s*/gi,
    /\bmemorizza che\b:?\s*/gi,
    /\bmemorizziamo\b:?\s*/gi,
    /\bricordiamoci che\b:?\s*/gi,
    /\bricordiamoci di\b:?\s*/gi,
    /\bricorda\b:?\s*/gi,
    /\bremember\b:?\s*/gi,
    /\btieni a mente\b:?\s*/gi,
    /\bkeep in mind\b:?\s*/gi,
    /\bnota che\b:?\s*/gi,
    /\bnote that\b:?\s*/gi,
  ];

  // Find the LAST sentence containing the explicit marker
  const sentences = text.match(/[^.!?]*[.!?]/g) || [];
  let lastMatchingSentence = '';
  let isolatedContent = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    // Check each pattern with lastIndex reset for regex safety
    for (const pattern of markerPatterns) {
      pattern.lastIndex = 0; // Reset regex lastIndex before testing
      if (pattern.test(trimmed)) {
        lastMatchingSentence = trimmed;

        // Extract content AFTER the marker
        pattern.lastIndex = 0; // Reset again for exec
        const match = pattern.exec(trimmed);
        if (match && match.index !== undefined) {
          isolatedContent = trimmed.substring(match.index + match[0].length).trim();
        }
        break; // Move to next sentence after finding match
      }
    }
  }

  // If no content isolated, fall back to normal classification
  if (!isolatedContent) {
    log('Debug: No content isolated, falling back to normal classification');
    const classification = inferClassification(text);
    const confidence = classification ? calculateClassificationScore(text, classification) : 0;
    return { classification, confidence, isolatedContent: text };
  }

  log('Debug: Isolated content for classification:', isolatedContent);

  // Score ONLY the isolated content for all classifications
  let bestClassification: string | null = null;
  let bestScore = 0;

  for (const [classification] of Object.entries(CLASSIFICATION_KEYWORDS)) {
    const score = calculateClassificationScore(isolatedContent, classification);
    if (score > bestScore) {
      bestScore = score;
      bestClassification = classification;
    }
  }

  // If classification found with score >= 0.4, return with boosted confidence (min 0.85)
  if (bestScore >= 0.4 && bestClassification) {
    const boostedConfidence = Math.max(0.85, bestScore);
    log(`Debug: Explicit intent classification: ${bestClassification}, score: ${bestScore}, boosted: ${boostedConfidence}`);
    return { classification: bestClassification, confidence: boostedConfidence, isolatedContent };
  }

  // If explicit intent detected but no specific classification found,
  // assign semantic classification with high confidence (0.85)
  // This ensures "Ricordati che [fatto generico]" is always stored
  log('Debug: No specific classification found for explicit intent, assigning semantic classification');
  return {
    classification: 'semantic',
    confidence: 0.85,
    isolatedContent
  };
}

// =============================================================================
// Role-Aware Classification
// =============================================================================

/**
 * Validate if a memory should be stored based on role rules
 *
 * Returns:
 * - store: whether to store the memory
 * - reason: human-readable reason for decision
 */
export function shouldStoreMemoryWithRole(
  text: string,
  classification: string,
  primaryRole: MessageRole
): { store: boolean; reason: string } {
  // Check if this classification has role validation rules
  const validationRules: any = {
    constraint: { validRoles: ['user'], requiresPrimary: true },
    preference: { validRoles: ['user'], requiresPrimary: true },
    learning: { validRoles: ['user'], requiresPrimary: true },
    procedural: { validRoles: ['user'], requiresPrimary: true },
    decision: { validRoles: ['user', 'assistant'], requiresPrimary: false },
    bugfix: { validRoles: ['user', 'assistant'], requiresPrimary: false },
    semantic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
    episodic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  };

  const rule = validationRules[classification];

  // If no rule, allow storage (backward compatibility)
  if (!rule) {
    return { store: true, reason: 'no_role_validation_rule' };
  }

  // Check if primary role is valid
  if (!rule.validRoles.includes(primaryRole)) {
    return {
      store: false,
      reason: `invalid_role_${primaryRole}_for_${classification}`,
    };
  }

  // Check if requires primary Human source
  if (rule.requiresPrimary && primaryRole !== 'user') {
    return {
      store: false,
      reason: `classification_${classification}_requires_human_primary`,
    };
  }

  // Additional check: down-weight Assistant-generated list patterns for user-level classifications
  if (rule.requiresPrimary && hasAssistantListPattern(text)) {
    log('Debug: Detected Assistant list pattern, filtering out as potential false positive');
    return {
      store: false,
      reason: 'assistant_list_pattern_detected',
    };
  }

  return { store: true, reason: 'role_validation_passed' };
}

/**
 * Classify content with role-aware context
 *
 * Takes into account:
 * - Primary role of the message (Human vs Assistant)
 * - Human intent signals (10x weight for Human messages)
 * - Role validation rules (user-level classifications must be from Human)
 *
 * Returns:
 * - classification: the inferred classification
 * - confidence: 0-1 score
 * - isolatedContent: the extracted content
 * - roleValidated: whether the role validation passed
 */
export function classifyWithRoleAwareness(
  text: string,
  signals: any[],
  roleAwareContext: RoleAwareContext | null
): {
  classification: string | null;
  confidence: number;
  isolatedContent: string;
  roleValidated: boolean;
  validationReason: string;
} {
  // First, do the standard classification with explicit intent detection
  const baseResult = classifyWithExplicitIntent(text, signals);
  const { classification, confidence, isolatedContent } = baseResult;

  // If no classification found, return early
  if (!classification) {
    return {
      classification: null,
      confidence: 0,
      isolatedContent: text,
      roleValidated: true,
      validationReason: 'no_classification_found',
    };
  }

  // If no role-aware context provided, allow storage (backward compatibility)
  if (!roleAwareContext) {
    log('Debug: No role-aware context, skipping role validation');
    return {
      classification,
      confidence,
      isolatedContent,
      roleValidated: true,
      validationReason: 'no_role_context',
    };
  }

  // Apply role validation
  const roleValidation = shouldStoreMemoryWithRole(
    isolatedContent,
    classification,
    roleAwareContext.primaryRole
  );

  if (!roleValidation.store) {
    log(`Debug: Role validation failed: ${roleValidation.reason} for ${classification}`);
    return {
      classification,
      confidence,
      isolatedContent,
      roleValidated: false,
      validationReason: roleValidation.reason,
    };
  }

  // Boost confidence for Human messages with high intent scores
  if (roleAwareContext.primaryRole === 'user') {
    const humanIntentScore = scoreHumanIntent(isolatedContent);
    if (humanIntentScore > 0.6) {
      // Apply 10x weight multiplier for Human messages with clear intent
      const boostedConfidence = Math.min(1, confidence * HUMAN_MESSAGE_WEIGHT_MULTIPLIER);
      log(`Debug: Applied Human weight multiplier: ${confidence.toFixed(2)} -> ${boostedConfidence.toFixed(2)}`);
      return {
        classification,
        confidence: boostedConfidence,
        isolatedContent,
        roleValidated: true,
        validationReason: 'human_intent_boosted',
      };
    }
  }

  return {
    classification,
    confidence,
    isolatedContent,
    roleValidated: true,
    validationReason: 'standard_role_aware',
  };
}

/**
 * Calculate role-weighted score for signals
 * Human messages get 10x weight for their signals
 */
export function calculateRoleWeightedScore(
  baseSignalScore: number,
  primaryRole: MessageRole,
  text: string
): number {
  if (primaryRole === 'user') {
    // Apply 10x weight for Human messages
    // Also consider human intent patterns
    const humanIntentScore = scoreHumanIntent(text);
    const intentMultiplier = 1 + (humanIntentScore * 2); // Up to 3x based on intent strength
    return Math.min(1, baseSignalScore * HUMAN_MESSAGE_WEIGHT_MULTIPLIER * intentMultiplier);
  }

  // Assistant messages get normal weight (can be boosted by acknowledgment patterns)
  return baseSignalScore;
}
