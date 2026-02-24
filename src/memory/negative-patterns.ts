/**
 * Negative Patterns for False Positive Prevention
 *
 * These patterns filter out common false positives before classification.
 * E.g., "resolve DNS" should NOT trigger bugfix classification.
 */

/**
 * AI Meta-Talk Patterns
 *
 * These patterns detect AI-generated content (summaries, meta-talk, task completions)
 * that should NEVER be stored as user memories, regardless of classification.
 *
 * Rationale: In multilingual contexts, AI output is often in English while user
 * preferences are in their primary language. These patterns catch AI-generated
 * content at the source, preventing it from polluting the memory database.
 */
export const AI_META_TALK_PATTERNS: RegExp[] = [
  // AI summary prefixes
  /^(Goal|Summary|Context|Analysis|Note|Overview|Background):\s+The user/i,
  /^(Goal|Summary|Context|Analysis|Note|Overview|Background):\s+This/i,

  // Task completion markers
  /^\[.*task.*completed\]/i,
  /^\[.*completed.*\]/i,
  /^\[Background task/i,

  // AI instructional prefixes
  /^Please (analyze|create|review|implement|explain|describe|summarize)/i,
  /^Let me (analyze|create|review|implement|explain|describe)/i,
  /^I will (analyze|create|review|implement|explain|describe)/i,

  // AI self-reference patterns
  /^This (file|code|implementation|solution|approach|method)/i,
  /^The (above|following|below) (code|solution|implementation)/i,
  /^Here('s| is) (the|a)/i,

  // AI meta-commentary
  /^Based on (the|my) analysis/i,
  /^After (reviewing|analyzing|examining)/i,
  /^Looking at (the|this)/i,
];

/**
 * Check if text appears to be AI-generated meta-talk
 */
export function isAIMetaTalk(text: string): boolean {
  return AI_META_TALK_PATTERNS.some(pattern => pattern.test(text.trim()));
}

// Negative patterns per classification type
export const NEGATIVE_PATTERNS: Record<string, RegExp[]> = {
  bugfix: [
    // resolve (not bug-related)
    /resolve\s+(dns|ip|address|hostname|url|uri|path)/i,
    /resolve\s+(promise|async|await)/i,
    /git\s+resolve/i,
    /resolve\s+conflict(?!.*(?:bug|error|crash|fail))/i,
    /resolve\s+overlapping/i,

    // fix (not bug-related)
    /fixed\s+(width|height|position|size|length)/i,
    /fix\s+(position|layout|spacing|padding|margin)/i,
    /fixed-point/i,
    /fixed\s+asset/i,

    // handle (not error-related)
    /handle\s+(click|event|input|change|submit|hover|focus|blur)/i,
    /event\s+handler/i,
    /click\s+handler/i,
    /handler\s+function/i,

    // address (not issue-related)
    /\baddress\s+(space|bar|book|ing)\b/i,
    /ip\s+address/i,
    /mac\s+address/i,
    /email\s+address/i,
    /memory\s+address/i,

    // error (not bug-related)
    /error\s*(handling|handler|boundary)/i,
    /type\s*error/i,  // TypeScript type errors in docs
  ],

  decision: [
    /decided\s+to\s+(run|start|begin|try|test|check|verify|use)/i,
    /decision\s+(tree|matrix|making)/i,
  ],

  learning: [
    /machine\s+learning/i,
    /deep\s+learning/i,
    /learning\s+(rate|curve)/i,
  ],

  constraint: [
    /database\s+constraint/i,
    /foreign\s+key\s+constraint/i,
    /unique\s+constraint/i,
  ],
};

/**
 * Check if text matches any negative pattern for the given classification
 * Also checks AI meta-talk patterns first (applies to all classifications)
 */
export function matchesNegativePattern(text: string, classification: string): boolean {
  // First, check if this is AI-generated meta-talk (applies to ALL classifications)
  if (isAIMetaTalk(text)) {
    return true;
  }

  const patterns = NEGATIVE_PATTERNS[classification];
  if (!patterns) return false;

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Get matching negative patterns (for debugging)
 */
export function getMatchingNegativePatterns(text: string, classification: string): string[] {
  const matches: string[] = [];

  // Check AI meta-talk first
  if (isAIMetaTalk(text)) {
    matches.push('[AI_META_TALK]');
  }

  const patterns = NEGATIVE_PATTERNS[classification];
  if (patterns) {
    matches.push(
      ...patterns
        .filter(pattern => pattern.test(text))
        .map(p => p.source)
    );
  }

  return matches;
}
