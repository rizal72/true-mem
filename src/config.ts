/**
 * True-Mem Configuration
 */

import { log } from './logger.js';
import type { PsychMemConfig, ScoringWeights, OpenCodeConfig, SweepConfig } from './types.js';

/**
 * Get max memories from environment variable with validation
 */
function getMaxMemories(): number {
  const envValue = process.env.TRUE_MEM_MAX_MEMORIES;
  if (!envValue) return 20; // Default

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < 1) {
    log(`Invalid TRUE_MEM_MAX_MEMORIES: ${envValue}, using default 20`);
    return 20;
  }

  if (parsed < 10) {
    log(`Warning: TRUE_MEM_MAX_MEMORIES=${parsed} may reduce context quality`);
  }
  if (parsed > 50) {
    log(`Warning: TRUE_MEM_MAX_MEMORIES=${parsed} may cause token bloat`);
  }

  return parsed;
}

// Default sweep config
export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  structuralWeight: 1.0,
  signalThreshold: 0.3,
  enableRegexPatterns: true,
  enableStructuralAnalysis: true,
  regexConfidence: 0.75,
  structuralConfidence: 0.5,
};

// Default scoring weights
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  recency: 0.20,
  frequency: 0.15,
  importance: 0.25,
  utility: 0.20,
  novelty: 0.10,
  confidence: 0.10,
  interference: -0.10,
};

// Default OpenCode-specific config
export const DEFAULT_OPENCODE_CONFIG: OpenCodeConfig = {
  injectOnCompaction: true,
  extractOnCompaction: true,
  extractOnMessage: true,
  maxCompactionMemories: 10,
  maxSessionStartMemories: 10,
  messageWindowSize: 3,
  messageImportanceThreshold: 0.5,
};

// Full default config
export const DEFAULT_CONFIG: PsychMemConfig = {
  agentType: 'opencode',
  dbPath: '~/.true-mem/memory.db',

  // Decay rates (per hour)
  stmDecayRate: 0.05,     // ~32-hour half-life
  ltmDecayRate: 0.01,     // Slow decay

  // Consolidation thresholds
  stmToLtmStrengthThreshold: 0.7,
  stmToLtmFrequencyThreshold: 3,

  // Scoring weights
  scoringWeights: DEFAULT_SCORING_WEIGHTS,

  // Retrieval settings
  defaultRetrievalLimit: 20,
  maxContextTokens: 4000,

  // Max memories configuration
  maxMemories: getMaxMemories(),
  maxTokensForMemories: 4000,

  get scopeQuotas() {
    const max = this.maxMemories;
    return {
      minGlobal: Math.floor(max * 0.3),
      minProject: Math.floor(max * 0.3),
      maxFlexible: max - Math.floor(max * 0.3) - Math.floor(max * 0.3),
    };
  },

  // Auto-promote to LTM
  autoPromoteToLtm: ['learning', 'decision'],

  // Memory limits
  maxMemoriesPerStop: 7,
  deduplicationThreshold: 0.7,

  // Context sweep
  sweep: DEFAULT_SWEEP_CONFIG,

  // OpenCode-specific
  opencode: DEFAULT_OPENCODE_CONFIG,

  // True-Mem improvement: decay only episodic
  applyDecayOnlyToEpisodic: true,
  decayThreshold: 0.1,
};

// Constraint configuration
export const CONSTRAINT_CONFIG = {
  maxConstraints: 10,
  alwaysInclude: true,
};
