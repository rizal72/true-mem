/**
 * True-Memory Configuration
 */

import type { PsychMemConfig, ScoringWeights, OpenCodeConfig, SweepConfig } from './types.js';

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
  dbPath: '~/.true-memory/memory.db',

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

  // Auto-promote to LTM
  autoPromoteToLtm: ['bugfix', 'learning', 'decision'],

  // Memory limits
  maxMemoriesPerStop: 7,
  deduplicationThreshold: 0.7,

  // Context sweep
  sweep: DEFAULT_SWEEP_CONFIG,

  // OpenCode-specific
  opencode: DEFAULT_OPENCODE_CONFIG,

  // True-Memory improvement: decay only episodic
  applyDecayOnlyToEpisodic: true,
  decayThreshold: 0.1,
};
