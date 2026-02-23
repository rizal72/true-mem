/**
 * Negative Patterns for False Positive Prevention
 *
 * These patterns filter out common false positives before classification.
 * E.g., "resolve DNS" should NOT trigger bugfix classification.
 */

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
 */
export function matchesNegativePattern(text: string, classification: string): boolean {
  const patterns = NEGATIVE_PATTERNS[classification];
  if (!patterns) return false;

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Get matching negative patterns (for debugging)
 */
export function getMatchingNegativePatterns(text: string, classification: string): string[] {
  const patterns = NEGATIVE_PATTERNS[classification];
  if (!patterns) return [];

  return patterns
    .filter(pattern => pattern.test(text))
    .map(p => p.source);
}
