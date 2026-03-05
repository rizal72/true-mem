/**
 * True-Mem Type Definitions
 * Adapted from PsychMem for OpenCode
 */

// =============================================================================
// Agent Types
// =============================================================================

export type AgentType = 'opencode';

// =============================================================================
// Memory Types
// =============================================================================

/**
 * Memory classification aligned with psychological memory models
 */
export type MemoryClassification =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'learning'
  | 'preference'
  | 'decision'
  | 'constraint';

/**
 * Memory scope determines injection behavior
 */
export type MemoryScope = 'user' | 'project';

/**
 * Classifications that are user-level (always injected)
 */
export const USER_LEVEL_CLASSIFICATIONS: MemoryClassification[] = [
  'constraint',
  'preference',
  'learning',
  'procedural',
];

/**
 * Classifications that are project-level (only injected for matching project)
 */
export const PROJECT_LEVEL_CLASSIFICATIONS: MemoryClassification[] = [
  'decision',
  'episodic',
  'semantic',
];

export function isUserLevelClassification(classification: MemoryClassification): boolean {
  return USER_LEVEL_CLASSIFICATIONS.includes(classification);
}

export function getScopeForClassification(classification: MemoryClassification): MemoryScope {
  return isUserLevelClassification(classification) ? 'user' : 'project';
}

/**
 * Memory store type
 */
export type MemoryStore = 'stm' | 'ltm';

/**
 * Memory status for lifecycle management
 */
export type MemoryStatus = 'active' | 'decayed' | 'pinned' | 'forgotten';

// =============================================================================
// Role-Aware Memory Types
// =============================================================================

/**
 * Message role from OpenCode SDK
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Role-aware context for memory extraction
 */
export interface RoleAwareContext {
  /**
   * Primary role of the message containing the memory candidate
   */
  primaryRole: MessageRole;

  /**
   * Role-weighted score (10x for Human messages)
   */
  roleWeightedScore: number;

  /**
   * Whether Assistant context supports the memory
   */
  hasAssistantContext: boolean;

  /**
   * Full conversation with role markers
   */
  fullConversation: string;
}

/**
 * A line with its role from the conversation
 */
export interface RoleAwareLine {
  text: string;
  role: MessageRole;
  lineNumber: number;
}

/**
 * Role validation rules for memory classifications
 * Determines which roles are valid sources for each classification type
 */
export const ROLE_VALIDATION_RULES: Record<string, { validRoles: MessageRole[]; requiresPrimary: boolean }> = {
  // User-level classifications: MUST originate from Human messages
  constraint: { validRoles: ['user'], requiresPrimary: true },
  preference: { validRoles: ['user'], requiresPrimary: true },
  learning: { validRoles: ['user'], requiresPrimary: true },
  procedural: { validRoles: ['user'], requiresPrimary: true },

  // Project-level classifications: Can be Assistant-acknowledged
  decision: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  semantic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
  episodic: { validRoles: ['user', 'assistant'], requiresPrimary: false },
};

/**
 * Weight multiplier for Human messages in signal scoring
 */
export const HUMAN_MESSAGE_WEIGHT_MULTIPLIER = 10;

/**
 * Check if a classification requires Human as primary source
 */
export function requiresHumanPrimary(classification: string): boolean {
  const rule = ROLE_VALIDATION_RULES[classification];
  return rule?.requiresPrimary ?? false;
}

/**
 * Check if a role is valid for a classification
 */
export function isValidRoleForClassification(classification: string, role: MessageRole): boolean {
  const rule = ROLE_VALIDATION_RULES[classification];
  return rule?.validRoles.includes(role) ?? true;
}

// =============================================================================
// Core Data Models
// =============================================================================

export interface Session {
  id: string;
  project: string;
  startedAt: Date;
  endedAt?: Date | undefined;
  status: 'active' | 'completed' | 'abandoned';
  metadata?: Record<string, unknown> | undefined;
  transcriptPath?: string | undefined;
  transcriptWatermark?: number | undefined;
  messageWatermark?: number | undefined;
}

export interface Event {
  id: string;
  sessionId: string;
  hookType: HookType;
  timestamp: Date;
  content: string;
  toolName?: string | undefined;
  toolInput?: string | undefined;
  toolOutput?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface MemoryUnit {
  id: string;
  sessionId?: string | undefined;
  store: MemoryStore;
  classification: MemoryClassification;
  summary: string;
  sourceEventIds: string[];
  projectScope?: string | undefined;

  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;

  recency: number;
  frequency: number;
  importance: number;
  utility: number;
  novelty: number;
  confidence: number;
  interference: number;

  strength: number;
  decayRate: number;

  tags: string[];
  associations: string[];

  status: MemoryStatus;
  version: number;

  evidence: MemoryEvidence[];
  embedding?: Float32Array | undefined;
}

export interface MemoryEvidence {
  eventId: string;
  timestamp: Date;
  contribution: string;
  confidenceDelta: number;
}

// =============================================================================
// Hook Types
// =============================================================================

export type HookType =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PostToolUse'
  | 'Stop'
  | 'SessionEnd';

export interface HookInput {
  hookType: HookType;
  sessionId: string;
  timestamp: string;
  data: HookData;
}

export type HookData =
  | SessionStartData
  | UserPromptSubmitData
  | PostToolUseData
  | StopData
  | SessionEndData;

export interface SessionStartData {
  project: string;
  workingDirectory: string;
  metadata?: Record<string, unknown>;
}

export interface UserPromptSubmitData {
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface PostToolUseData {
  toolName: string;
  toolInput: string;
  toolOutput: string;
  success: boolean;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface StopData {
  reason: 'user' | 'complete' | 'error' | 'timeout' | 'compaction';
  stopReason?: string;
  conversationText?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionEndData {
  reason: 'normal' | 'clear' | 'abandoned';
  metadata?: Record<string, unknown>;
}

export interface HookOutput {
  success: boolean;
  context?: string;
  error?: string;
  memoriesCreated?: number;
}

// =============================================================================
// Context Sweep Types
// =============================================================================

export interface MemoryCandidate {
  summary: string;
  classification: MemoryClassification;
  sourceEventIds: string[];
  importanceSignals: ImportanceSignal[];
  preliminaryImportance: number;
  extractionMethod: string;
  confidence: number;
}

export interface ImportanceSignal {
  type: ImportanceSignalType;
  source: string;
  weight: number;
}

export type ImportanceSignalType =
  | 'explicit_remember'
  | 'emphasis_cue'
  | 'correction'
  | 'repeated_request'
  | 'emotional_language'
  | 'tool_failure'
  | 'bug_fix'
  | 'decision'
  | 'constraint'
  | 'preference'
  | 'learning'
  | 'typography_emphasis'
  | 'correction_pattern'
  | 'repetition_pattern'
  | 'elaboration'
  | 'structural_enumeration'
  | 'meta_reference'
  | 'quoted_text'
  | 'code_block';

// =============================================================================
// Scoring and Retrieval Types
// =============================================================================

export interface MemoryFeatureVector {
  recency: number;
  frequency: number;
  importance: number;
  utility: number;
  novelty: number;
  confidence: number;
  interference: number;
}

export interface ScoringWeights {
  recency: number;
  frequency: number;
  importance: number;
  utility: number;
  novelty: number;
  confidence: number;
  interference: number;
}

export interface RetrievalQuery {
  query: string;
  filters?: RetrievalFilters | undefined;
  limit?: number | undefined;
  includeDecayed?: boolean | undefined;
}

export interface RetrievalFilters {
  store?: MemoryStore;
  classifications?: MemoryClassification[];
  minStrength?: number;
  tags?: string[];
  since?: Date;
}

// =============================================================================
// Configuration
// =============================================================================

export interface SweepConfig {
  structuralWeight: number;
  signalThreshold: number;
  enableRegexPatterns: boolean;
  enableStructuralAnalysis: boolean;
  regexConfidence: number;
  structuralConfidence: number;
}

export interface OpenCodeConfig {
  injectOnCompaction: boolean;
  extractOnCompaction: boolean;
  extractOnMessage: boolean;
  maxCompactionMemories: number;
  maxSessionStartMemories: number;
  messageWindowSize: number;
  messageImportanceThreshold: number;
}

export interface ScopeQuotas {
  minGlobal: number;
  minProject: number;
  maxFlexible: number;
}

export interface PsychMemConfig {
  agentType: AgentType;
  dbPath: string;
  
  stmDecayRate: number;
  ltmDecayRate: number;
  
  stmToLtmStrengthThreshold: number;
  stmToLtmFrequencyThreshold: number;
  
  scoringWeights: ScoringWeights;
  
  defaultRetrievalLimit: number;
  maxContextTokens: number;
  
  // Memory injection limits
  maxMemories: number;
  maxTokensForMemories: number;
  
  // Scope quotas (computed getter)
  scopeQuotas: ScopeQuotas;
  
  autoPromoteToLtm: MemoryClassification[];
  
  maxMemoriesPerStop: number;
  deduplicationThreshold: number;
  
  sweep: SweepConfig;
  opencode: OpenCodeConfig;
  
  // True-Mem additions
  applyDecayOnlyToEpisodic?: boolean;
  decayThreshold?: number;
}

// =============================================================================
// OpenCode Plugin Types (re-export from SDK)
// =============================================================================

// Re-export types from @opencode-ai/plugin for convenience
export type { Plugin, PluginInput, Hooks } from '@opencode-ai/plugin';
export type { Message, Part } from '@opencode-ai/sdk';

// Rename SDK Event to avoid conflict with our Event type
export type OpenCodeEvent = import('@opencode-ai/sdk').Event;
