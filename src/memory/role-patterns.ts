/**
 * Role-Aware Pattern Detection
 *
 * Heuristics for distinguishing Human vs Assistant message patterns
 * to improve memory extraction accuracy.
 */

import type { MessageRole } from '../types.js';

// =============================================================================
// Human-Primary Patterns
// =============================================================================

/**
 * Patterns that strongly indicate Human intent
 * These are first-person expressions of preferences, decisions, or constraints
 */
const HUMAN_INTENT_PATTERNS = [
  // Explicit remember/remember me
  /\b(?:remember|ricorda|keep in mind|tieni a mente|note that|nota che)\s*(?:this|questo)?\s*(?:for me|per me)?\b/gi,

  // First-person preference statements
  /\b(?:i prefer|i like|i want|i'd rather|preferisco|mi piace|voglio|prediligo)\b/gi,

  // First-person learning statements
  /\b(?:i learned|i discovered|i realized|i figured out|imparato|scoperto|capito)\b/gi,

  // First-person constraint statements
  /\b(?:i can't|i cannot|i must never|i will never|non posso|non devo)\b/gi,

  // First-person decision statements
  /\b(?:i decided|i chose|i picked|i went with|deciso|scelto|selezionato)\b/gi,

  // Direct imperatives and commands (Human → Assistant)
  /\b(?:never|always|don't|make sure|ensure|mai|sempre|non)\s+(?:use|do|try|avoid|usa|fare|prova|evita)\b/gi,
];

/**
 * Patterns that indicate Assistant acknowledgment or restatement
 * These are rephrasings of user intent and should not be primary sources
 */
const ASSISTANT_ACKNOWLEDGMENT_PATTERNS = [
  // Third-person restatements
  /\b(?:you prefer|you like|you want|you decided|you chose|you learned)\b/gi,

  // Neutral reporting
  /\b(?:the user prefers|the user decided|the user learned|the user wants)\b/gi,

  // Acknowledgment markers
  /\b(?:understood|noted|acknowledged|got it|ok|alright|capito|notato)\b/gi,

  // Passive restatements
  /\b(?:it was decided|it was chosen|it was learned)\b/gi,
];

// =============================================================================
// Pattern Scoring
// =============================================================================

/**
 * Score a message for Human intent signals
 * Returns 0-1 score, higher = more likely Human intent
 */
export function scoreHumanIntent(text: string): number {
  const textLower = text.toLowerCase();
  let score = 0;

  for (const pattern of HUMAN_INTENT_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = textLower.match(pattern);
    if (matches) {
      score += matches.length * 0.3;
    }
  }

  // Cap at 1.0
  return Math.min(1.0, score);
}

/**
 * Score a message for Assistant acknowledgment patterns
 * Returns 0-1 score, higher = more likely Assistant restatement
 */
export function scoreAssistantAcknowledgment(text: string): number {
  const textLower = text.toLowerCase();
  let score = 0;

  for (const pattern of ASSISTANT_ACKNOWLEDGMENT_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = textLower.match(pattern);
    if (matches) {
      score += matches.length * 0.25;
    }
  }

  // Cap at 1.0
  return Math.min(1.0, score);
}

/**
 * Infer the likely role from text patterns
 * Returns the inferred role or null if unclear
 */
export function inferRoleFromText(text: string): MessageRole | null {
  const humanScore = scoreHumanIntent(text);
  const assistantScore = scoreAssistantAcknowledgment(text);

  if (humanScore > 0.6 && humanScore > assistantScore * 1.5) {
    return 'user';
  }

  if (assistantScore > 0.6 && assistantScore > humanScore * 1.5) {
    return 'assistant';
  }

  return null;
}

/**
 * Check if a message contains explicit remember/remember me signals
 * These are strong indicators of Human intent
 */
export function hasExplicitRememberSignal(text: string): boolean {
  const patterns = [
    /\bricorda questo\b:?\s*/gi,
    /\bremember this\b:?\s*/gi,
    /\bricorda\b:?\s*/gi,
    /\bremember\b:?\s*/gi,
    /\btieni a mente\b:?\s*/gi,
    /\bkeep in mind\b:?\s*/gi,
    /\bnota che\b:?\s*/gi,
    /\bnote that\b:?\s*/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a message contains Assistant-generated list patterns
 * These are often rephrasings and should be down-weighted
 */
export function hasAssistantListPattern(text: string): boolean {
  // Pattern: Assistant rephrasing user preferences as a list
  const listPatterns = [
    /(?:based on your (?:preferences|constraints|requirements),?)\s*(?:i'll|i will)\s*(?:remember|note)\s*:/gi,
    /(?:i've|i have)\s*(?:noted|remembered)\s*(?:that|the following)\s*:/gi,
    /(?:here's|here is)\s*(?:what i've|i have)\s*(?:learned|noted)\s*:/gi,
    /(?:from our conversation,)\s*(?:i|we)\s*(?:can see|understand)\s*:/gi,
  ];

  for (const pattern of listPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// Context Building
// =============================================================================

/**
 * Build role-aware context from a line with its surrounding messages
 */
export interface RoleAwareLine {
  text: string;
  role: MessageRole;
  lineNumber: number;
}

/**
 * Extract role-aware context for a specific line in the conversation
 * Returns the line with its role and surrounding context
 */
export function extractRoleAwareContext(
  lines: string[],
  targetIndex: number,
  contextWindow: number = 3
): RoleAwareLine | null {
  if (targetIndex < 0 || targetIndex >= lines.length) {
    return null;
  }

  const line = lines.at(targetIndex);
  if (!line) {
    return null;
  }

  // Parse role from line format: "Human: ..." or "Assistant: ..."
  const roleMatch = line.match(/^(Human|Assistant):\s*/i);
  if (!roleMatch) {
    return null;
  }

  const roleLabel = roleMatch[1];
  if (!roleLabel) {
    return null;
  }

  const role: MessageRole = roleLabel.toLowerCase() === 'human' ? 'user' : 'assistant';

  return {
    text: line.substring(roleMatch[0].length).trim(),
    role,
    lineNumber: targetIndex,
  };
}

/**
 * Extract all lines with their roles from a conversation
 */
export function parseConversationLines(conversation: string): RoleAwareLine[] {
  const lines: RoleAwareLine[] = [];

  conversation.split('\n').forEach((text, index) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const roleMatch = trimmed.match(/^(Human|Assistant):\s*/i);
    if (!roleMatch) return;

    const roleLabel = roleMatch[1];
    if (!roleLabel) return;

    lines.push({
      text: trimmed.substring(roleMatch[0].length).trim(),
      role: roleLabel.toLowerCase() === 'human' ? 'user' : 'assistant',
      lineNumber: index,
    });
  });

  return lines;
}
