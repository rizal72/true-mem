/**
 * True-Mem Configuration
 * 
 * Provides unified access to plugin configuration.
 * Uses loadConfig() from config/config.ts for user settings.
 */

import type { PsychMemConfig, ScoringWeights, OpenCodeConfig, SweepConfig, ScopeQuotas } from './types.js';
import { getInjectionConfig } from './config/injection-mode.js';
import { loadConfig } from './config/config.js';
import { loadState } from './config/state.js';

/**
 * Compute scope quotas based on max memories
 */
export function getScopeQuotas(maxMemories: number): ScopeQuotas {
  const minGlobal = Math.floor(maxMemories * 0.3);
  const minProject = Math.floor(maxMemories * 0.3);
  return {
    minGlobal,
    minProject,
    maxFlexible: maxMemories - minGlobal - minProject,
  };
}

/**
 * Get effective max memories (from config with env override)
 */
export function getMaxMemories(): number {
  return loadConfig().maxMemories;
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

/**
 * Get the default OpenCode-specific config
 * Note: injection config is loaded at runtime via getInjectionConfig()
 */
export function getDefaultOpenCodeConfig(): OpenCodeConfig {
  return {
    injectOnCompaction: true,
    extractOnCompaction: true,
    extractOnMessage: true,
    maxCompactionMemories: 10,
    maxSessionStartMemories: 10,
    messageWindowSize: 3,
    messageImportanceThreshold: 0.5,
    injection: getInjectionConfig(),
  };
}

/**
 * Get the full default config (runtime evaluation)
 */
export function getDefaultConfig(): PsychMemConfig {
  const maxMemories = getMaxMemories();
  
  return {
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
    maxMemories,
    maxTokensForMemories: 4000,

    // Scope quotas computed at initialization
    scopeQuotas: getScopeQuotas(maxMemories),

    // Auto-promote to LTM
    autoPromoteToLtm: ['learning', 'decision'],

    // Memory limits
    maxMemoriesPerStop: 7,
    deduplicationThreshold: 0.7,

    // Context sweep
    sweep: DEFAULT_SWEEP_CONFIG,

    // OpenCode-specific
    opencode: getDefaultOpenCodeConfig(),

    // True-Mem improvement: decay only episodic
    applyDecayOnlyToEpisodic: true,
    decayThreshold: 0.1,
  };
}

// Backward compatibility: keep DEFAULT_CONFIG for existing code
// Note: This uses defaults, use getDefaultConfig() for runtime values
export const DEFAULT_CONFIG: PsychMemConfig = {
  agentType: 'opencode',
  dbPath: '~/.true-mem/memory.db',

  // Decay rates (per hour)
  stmDecayRate: 0.05,
  ltmDecayRate: 0.01,

  // Consolidation thresholds
  stmToLtmStrengthThreshold: 0.7,
  stmToLtmFrequencyThreshold: 3,

  // Scoring weights
  scoringWeights: DEFAULT_SCORING_WEIGHTS,

  // Retrieval settings
  defaultRetrievalLimit: 20,
  maxContextTokens: 4000,

  // Max memories configuration (defaults)
  maxMemories: 20,
  maxTokensForMemories: 4000,

  // Scope quotas (defaults)
  scopeQuotas: getScopeQuotas(20),

  // Auto-promote to LTM
  autoPromoteToLtm: ['learning', 'decision'],

  // Memory limits
  maxMemoriesPerStop: 7,
  deduplicationThreshold: 0.7,

  // Context sweep
  sweep: DEFAULT_SWEEP_CONFIG,

  // OpenCode-specific
  opencode: getDefaultOpenCodeConfig(),

  // True-Mem improvement: decay only episodic
  applyDecayOnlyToEpisodic: true,
  decayThreshold: 0.1,
};

// Constraint configuration
export const CONSTRAINT_CONFIG = {
  maxConstraints: 10,
  alwaysInclude: true,
};

// Re-export for convenience
export { loadConfig, loadState };
