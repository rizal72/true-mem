/**
 * True-Memory OpenCode Adapter
 */

const BUILD_TIME = "2026-02-23T09:45:00.000Z";

import type { PluginInput, Hooks, Event, Message, Part } from '../../types.js';
import type { PsychMemConfig, MemoryUnit, RoleAwareContext, RoleAwareLine, MessageRole } from '../../types.js';
import { DEFAULT_CONFIG } from '../../config.js';
import { MemoryDatabase, createMemoryDatabase } from '../../storage/database.js';
import { log } from '../../logger.js';
import {
  shouldStoreMemory,
  classifyWithExplicitIntent,
  classifyWithRoleAwareness,
  calculateRoleWeightedScore,
} from '../../memory/classifier.js';
import { matchAllPatterns } from '../../memory/patterns.js';
import { embed } from '../../memory/embeddings.js';
import { getExtractionQueue } from '../../extraction/queue.js';
import { registerShutdownHandler, executeShutdown } from '../../shutdown.js';
import { parseConversationLines } from '../../memory/role-patterns.js';

// Debounce state for message.updated events
let messageDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMessageEvent: { properties: unknown } | null = null;

// Message container type matching SDK response
interface MessageContainer {
  info: Message;
  parts: Part[];
}

// Session ID extraction helper
function getSessionIdFromEvent(properties?: Record<string, unknown>): string | undefined {
  if (!properties) return undefined;
  const info = properties.info as Record<string, unknown> | undefined;
  if (info && typeof info.id === 'string') return info.id;
  if (typeof properties.sessionID === 'string') return properties.sessionID;
  if (typeof properties.id === 'string') return properties.id;
  return undefined;
}

// Sub-agent detection helper
function isSubAgentSession(sessionId: string): boolean {
  // Heuristic: sub-agent sessions typically contain "-task-" in the ID
  return sessionId.includes('-task-');
}

// Debounce helper for message.updated events
function debounceMessageUpdate(
  state: TrueMemoryAdapterState,
  eventProps: unknown,
  handler: (state: TrueMemoryAdapterState, props: Record<string, unknown> | undefined) => Promise<void>
) {
  pendingMessageEvent = { properties: eventProps };

  if (messageDebounceTimer) {
    clearTimeout(messageDebounceTimer);
  }

  messageDebounceTimer = setTimeout(() => {
    if (pendingMessageEvent) {
      handler(state, pendingMessageEvent.properties as Record<string, unknown> | undefined)
        .catch(err => log(`Message processing error: ${err}`));
    }
    pendingMessageEvent = null;
    messageDebounceTimer = null;
  }, 500); // 500ms debounce
}

// Adapter state
interface TrueMemoryAdapterState {
  db: MemoryDatabase;
  config: PsychMemConfig;
  currentSessionId: string | null;
  injectedSessions: Set<string>;
  worktree: string;
  client: PluginInput['client'];
}

/**
 * Create OpenCode plugin hooks
 */
export async function createTrueMemoryPlugin(
  ctx: PluginInput,
  configOverrides: Partial<PsychMemConfig> = {}
): Promise<Hooks> {
  log('createTrueMemoryPlugin called');
  
  const config: PsychMemConfig = {
    ...DEFAULT_CONFIG,
    ...configOverrides,
  };
  
  // Initialize database
  const db = await createMemoryDatabase(config);
  log('Database initialized');

  // Register shutdown handler for database
  registerShutdownHandler('database', () => db.close());

  // Resolve project root
  const worktree = (!ctx.worktree || ctx.worktree === '/' || ctx.worktree === '\\')
    ? ctx.directory
    : ctx.worktree;
  
  const state: TrueMemoryAdapterState = {
    db,
    config,
    currentSessionId: null,
    injectedSessions: new Set<string>(),
    worktree,
    client: ctx.client,
  };

  log(`True-Memory initialized — worktree=${worktree}`);

  // Extract project name and create professional startup message
  const projectName = worktree.split(/[/\\]/).pop() || 'Unknown';
  const startupMessage = `🧠 True-Memory: Plugin loaded successfully | v2.0.1 [${BUILD_TIME}] | Mode: Vector (Transformers.js) | Project: ${projectName}`;

  // Log to file-based logger only (to avoid overwriting OpenCode TUI during lazy initialization)
  log(startupMessage);

  return {
    event: async ({ event }) => {
      // Skip noisy events
      const silentEvents = new Set(['message.part.delta', 'message.part.updated', 'session.diff']);
      if (silentEvents.has(event.type)) return;
      
      log(`Event: ${event.type}`);
      const sessionId = getSessionIdFromEvent(event.properties);
      
      switch (event.type) {
        case 'session.created':
          await handleSessionCreated(state, sessionId);
          break;
        case 'session.idle':
          // Add extraction job to queue for sequential processing
          queueExtractionJob(state, sessionId);
          break;
        case 'session.deleted':
        case 'session.error':
          await handleSessionEnd(state, event.type, sessionId);
          break;
        case 'server.instance.disposed':
          // Server is shutting down, execute graceful shutdown
          log('Server instance disposed, executing shutdown sequence');
          await executeShutdown('server.instance.disposed');
          break;
        case 'message.updated':
          if (state.config.opencode.extractOnMessage) {
            // Debounce message updates to avoid blocking UI
            debounceMessageUpdate(state, event.properties, handleMessageUpdated);
          }
          break;
      }
    },
    
    'tool.execute.after': async (input, output) => {
      log(`tool.execute.after: ${input.tool}`);
      
      if (!state.currentSessionId && input.sessionID) {
        state.currentSessionId = input.sessionID;
      }
      
      if (!state.currentSessionId) return;
      
      await handlePostToolUse(state, input, output);
    },
    
    'experimental.session.compacting': async (input, output) => {
      log('Compaction hook triggered');
      
      const sessionId = input.sessionID ?? state.currentSessionId;
      
      if (state.config.opencode.injectOnCompaction) {
        const memories = await getRelevantMemories(state, state.config.opencode.maxCompactionMemories);
        
        if (memories.length > 0) {
          const memoryContext = formatMemoriesForInjection(memories, state.worktree);
          output.prompt = buildCompactionPrompt(memoryContext);
          log(`Injected ${memories.length} memories into compaction`);
        } else {
          output.prompt = buildCompactionPrompt(null);
        }
      }
    },
  };
}

// Queue helper for session idle processing
function queueExtractionJob(
  state: TrueMemoryAdapterState,
  sessionId?: string
): void {
  const queue = getExtractionQueue();

  queue.add({
    description: `session:${sessionId ?? state.currentSessionId}`,
    execute: async () => {
      await processSessionIdle(state, sessionId);
    },
  });
}

// Session handlers
async function handleSessionCreated(
  state: TrueMemoryAdapterState,
  sessionId?: string
): Promise<void> {
  if (!sessionId) return;
  
  state.currentSessionId = sessionId;
  state.injectedSessions.add(sessionId);
  log(`Session created: ${sessionId}`);
  
  // Run maintenance: decay and consolidation
  try {
    const decayed = state.db.applyDecay();
    const promoted = state.db.runConsolidation();
    if (decayed > 0 || promoted > 0) {
      log(`Maintenance: decayed ${decayed} memories, promoted ${promoted} to LTM`);
    }
  } catch (err) {
    log(`Maintenance error: ${err}`);
  }
  
  // Create session in DB
  state.db.createSession(sessionId, state.worktree, { agentType: 'opencode' });
  
  // Inject memories
  const memories = await getRelevantMemories(state, state.config.opencode.maxSessionStartMemories);
  
  if (memories.length > 0) {
    const memoryContext = formatMemoriesForInjection(memories, state.worktree);
    await injectContext(state, sessionId, memoryContext);
    log(`Injected ${memories.length} memories on session start`);
  }
}

async function processSessionIdle(
  state: TrueMemoryAdapterState,
  sessionId?: string
): Promise<void> {
  const effectiveSessionId = sessionId ?? state.currentSessionId;
  if (!effectiveSessionId) return;

  if (sessionId && !state.currentSessionId) {
    state.currentSessionId = sessionId;
  }

  // Skip extraction for sub-agent sessions to avoid duplicate extraction
  if (isSubAgentSession(effectiveSessionId)) {
    log(`Skipping extraction: sub-agent session detected (${effectiveSessionId})`);
    return;
  }

  const watermark = state.db.getMessageWatermark(effectiveSessionId);

  let messages: MessageContainer[];
  try {
    const response = await state.client.session.messages({ path: { id: effectiveSessionId } });
    if (response.error) {
      log(`Failed to fetch messages: ${response.error}`);
      return;
    }
    messages = response.data ?? [];
  } catch (error) {
    log(`Failed to fetch messages: ${error}`);
    return;
  }

  if (!messages || messages.length <= watermark) return;

  const newMessages = messages.slice(watermark);
  const { text: conversationText, lines: roleLines } = extractConversationTextWithRoles(newMessages);

  log('Debug: Clean conversation text (start):', conversationText.slice(0, 200));
  log('Debug: Role-aware lines extracted:', roleLines.length);

  if (!conversationText.trim()) {
    state.db.updateMessageWatermark(effectiveSessionId, messages.length);
    return;
  }

  // Check for injection markers as a final safety net before processing
  const injectionMarkers = [
    /## Relevant Memories from Previous Sessions/i,
    /### User Preferences & Constraints/i,
    /### .* Context/i,
    /## Compaction Instructions/i,
    /\[LTM\]/i,
    /\[STM\]/i,
  ];

  const hasInjectedContent = injectionMarkers.some(marker => marker.test(conversationText));
  if (hasInjectedContent) {
    log(`WARNING: Conversation contains injection markers (safety check), extractConversationText should have filtered them out`);
    // Don't skip extraction - let the filtered conversationText be processed
  }

  // Extract memories using role-aware classifier
  log(`Processing ${newMessages.length} new messages, ${roleLines.length} lines with role info`);

  // Get signals from patterns (applied to full conversation)
  const signals = matchAllPatterns(conversationText);
  log('Debug: Detected signals:', JSON.stringify(signals));

  let extractionAttempted = false;
  let extractionSucceeded = false;

  if (signals.length > 0) {
    extractionAttempted = true;

    try {
      // Process each Human message with role-aware classification
      const humanMessages = roleLines.filter(line => line.role === 'user');
      log(`Debug: Processing ${humanMessages.length} Human messages for memory extraction`);

      for (const humanMsg of humanMessages) {
        const { text, role } = humanMsg;

        // Get signals specific to this message
        const msgSignals = matchAllPatterns(text);
        if (msgSignals.length === 0) {
          continue; // No signals in this message, skip
        }

        log(`Debug: Processing Human message (${msgSignals.length} signals):`, text.slice(0, 100));

        // Calculate base signal score (average weight of matched signals)
        const baseSignalScore = msgSignals.reduce((sum, s) => sum + s.weight, 0) / msgSignals.length;

        // Apply role weighting (10x for Human messages)
        const roleWeightedScore = calculateRoleWeightedScore(baseSignalScore, role, text);
        log(`Debug: Role-weighted score: ${roleWeightedScore.toFixed(2)} (base: ${baseSignalScore.toFixed(2)})`);

        // Build role-aware context
        const roleAwareContext: RoleAwareContext = {
          primaryRole: role,
          roleWeightedScore,
          hasAssistantContext: roleLines.some(line => line.role === 'assistant'),
          fullConversation: conversationText,
        };

        // Classify with role-awareness
        const { classification, confidence, isolatedContent, roleValidated, validationReason } = classifyWithRoleAwareness(
          text,
          msgSignals,
          roleAwareContext
        );

        log(`Debug: Classification result: ${classification}, confidence: ${confidence.toFixed(2)}, roleValidated: ${roleValidated}, reason: ${validationReason}`);

        if (classification && roleValidated) {
          // Apply three-layer defense
          const result = shouldStoreMemory(isolatedContent, classification, baseSignalScore);

          if (result.store) {
            // Determine scope
            const userLevelClassifications = ['constraint', 'preference', 'learning', 'procedural'];
            const scope = userLevelClassifications.includes(classification) ? undefined : state.worktree;

            // Generate embedding for the memory
            const embedding = await embed(isolatedContent);

            // Store memory
            await state.db.createMemory(
              'stm',
              classification as any,
              extractCleanSummary(isolatedContent), // Clean summary without prefixes
              [],
              {
                sessionId: effectiveSessionId,
                projectScope: scope,
                importance: confidence, // Use confidence from classifyWithRoleAwareness
                confidence: confidence,
                embedding,
              }
            );

            log(`Stored ${classification} memory (confidence: ${confidence.toFixed(2)}, role: ${role})`);
          } else {
            log(`Skipped ${classification} memory: ${result.reason}`);
          }
        } else if (classification && !roleValidated) {
          log(`Skipped ${classification} memory: ${validationReason}`);
        }
      }

      extractionSucceeded = true;
    } catch (error) {
      log(`Extraction failed with critical error: ${error}`);
      // Don't update watermark if extraction failed with critical error
      return;
    }
  }

  // Only update watermark if extraction was attempted and succeeded, or if no extraction was needed
  if (!extractionAttempted || extractionSucceeded) {
    state.db.updateMessageWatermark(effectiveSessionId, messages.length);
  }
}

async function handleSessionEnd(
  state: TrueMemoryAdapterState,
  eventType: string,
  sessionId?: string
): Promise<void> {
  const effectiveSessionId = sessionId ?? state.currentSessionId;
  if (!effectiveSessionId) return;
  
  const reason = eventType === 'session.error' ? 'abandoned' : 'normal';
  state.db.endSession(effectiveSessionId, reason === 'abandoned' ? 'abandoned' : 'completed');
  state.currentSessionId = null;
  log(`Session ended: ${effectiveSessionId} (${reason})`);
}

async function handleMessageUpdated(
  state: TrueMemoryAdapterState,
  eventProps: Record<string, unknown> | undefined
): Promise<void> {
  const info = eventProps?.info as { sessionID?: string; role?: string; parts?: Part[] } | undefined;
  const sessionId = info?.sessionID ?? (eventProps?.sessionID as string | undefined) ?? state.currentSessionId;
  if (!sessionId) return;

  if (!state.currentSessionId && sessionId) {
    state.currentSessionId = sessionId;
  }

  // Lazy injection for continued sessions
  const role = info?.role ?? (eventProps?.role as string | undefined);
  if (role === 'user' && !state.injectedSessions.has(sessionId)) {
    state.injectedSessions.add(sessionId);
    log(`Lazy injection for session ${sessionId}`);

    // Extract user's message content for contextual retrieval
    let userQuery: string | undefined;
    const parts = info?.parts ?? (eventProps?.parts as Part[] | undefined);
    if (parts && parts.length > 0) {
      for (const part of parts) {
        if (part.type === 'text' && 'text' in part) {
          userQuery = (part as { text: string }).text;
          break;
        }
      }
    }

    const memories = await getRelevantMemories(state, state.config.opencode.maxSessionStartMemories, userQuery);
    if (memories.length > 0) {
      const memoryContext = formatMemoriesForInjection(memories, state.worktree);
      await injectContext(state, sessionId, memoryContext);
      log(`Lazy injection: ${memories.length} memories`);
    }
  }
}

async function handlePostToolUse(
  state: TrueMemoryAdapterState,
  input: { tool: string; sessionID: string; callID: string; args: unknown },
  output: { title: string; output: string; metadata: unknown }
): Promise<void> {
  const sessionId = state.currentSessionId;
  if (!sessionId) return;
  
  const toolOutput = output.output && output.output.length > 2000
    ? output.output.slice(0, 2000) + '...[truncated]'
    : (output.output ?? '');
  
  state.db.createEvent(sessionId, 'PostToolUse', '', {
    toolName: input.tool,
    toolInput: JSON.stringify(input.args),
    toolOutput,
  });
}

// Helpers

/**
 * Extract a clean summary from conversation text.
 * Removes "Human:" / "Assistant:" prefixes and trims to reasonable length.
 */
function extractCleanSummary(conversationText: string, maxLength: number = 500): string {
  // Remove role prefixes
  let cleaned = conversationText
    .replace(/^(Human|Assistant):\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  // Remove any remaining injection markers (second line of defense)
  const injectionMarkers = [
    /## Relevant Memories from Previous Sessions/gi,
    /### User Preferences & Constraints/gi,
    /### .* Context/gi,
    /## Compaction Instructions/gi,
    /\[LTM\]/gi,
    /\[STM\]/gi,
  ];

  for (const marker of injectionMarkers) {
    cleaned = cleaned.replace(marker, '');
  }

  // Normalize whitespace after marker removal
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Truncate if necessary, try to break at word boundaries
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Find last complete word within limit
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

function extractConversationText(messages: MessageContainer[]): string {
  const lines: string[] = [];

  // Regex patterns that indicate injected content (case-insensitive, should be filtered out)
  const injectionMarkers = [
    /## Relevant Memories from Previous Sessions/i,
    /### User Preferences & Constraints/i,
    /### .* Context/i,  // Matches "### ProjectName Context" pattern
    /## Compaction Instructions/i,
    /\[LTM\]/i,
    /\[STM\]/i,
  ];

  // Regex patterns that indicate tool execution or results (should be filtered out)
  const toolMarkers = [
    /\[Tool:\s*\w+\]/i,
    /^Tool Result:/i,
    /^Tool Error:/i,
    /<tool_use>[\s\S]*?<\/tool_use>/gi,  // Strip <tool_use> blocks
    /<tool_result>[\s\S]*?<\/tool_result>/gi,  // Strip <tool_result> blocks
    /```json[\s\S]*?"tool"[\s\S]*?```/gi,  // Strip JSON blobs with tool
  ];

  for (const msg of messages) {
    const role = msg.info.role === 'user' ? 'Human' : 'Assistant';

    for (const part of msg.parts) {
      if (part.type === 'text' && 'text' in part) {
        const text = (part as { text: string }).text;

        // Skip parts that contain any injection marker (prevents re-extracting injected content)
        const hasInjectionMarker = injectionMarkers.some(marker => marker.test(text));
        if (hasInjectionMarker) {
          continue; // Skip this part entirely
        }

        // Skip parts that look like tool execution or results
        const hasToolMarker = toolMarkers.some(marker => marker.test(text));
        if (hasToolMarker) {
          continue; // Skip this part entirely
        }

        lines.push(`${role}: ${text}`);
      } else if (part.type === 'tool') {
        const toolPart = part as { tool?: string; state?: { status?: string; output?: string; error?: string } };
        if (toolPart.state?.status === 'completed' || toolPart.state?.status === 'error') {
          lines.push(`Assistant: [Tool: ${toolPart.tool}]`);
          if (toolPart.state.output) lines.push(`Tool Result: ${toolPart.state.output.slice(0, 2000)}`);
          if (toolPart.state.error) lines.push(`Tool Error: ${toolPart.state.error}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract conversation text with role information
 * Returns both the text and role-aware line information
 */
function extractConversationTextWithRoles(messages: MessageContainer[]): {
  text: string;
  lines: RoleAwareLine[];
} {
  const textLines: string[] = [];
  const roleLines: RoleAwareLine[] = [];

  // Regex patterns that indicate injected content (case-insensitive, should be filtered out)
  const injectionMarkers = [
    /## Relevant Memories from Previous Sessions/i,
    /### User Preferences & Constraints/i,
    /### .* Context/i,  // Matches "### ProjectName Context" pattern
    /## Compaction Instructions/i,
    /\[LTM\]/i,
    /\[STM\]/i,
  ];

  // Regex patterns that indicate tool execution or results (should be filtered out)
  const toolMarkers = [
    /\[Tool:\s*\w+\]/i,
    /^Tool Result:/i,
    /^Tool Error:/i,
    /<tool_use>[\s\S]*?<\/tool_use>/gi,  // Strip <tool_use> blocks
    /<tool_result>[\s\S]*?<\/tool_result>/gi,  // Strip <tool_result> blocks
    /```json[\s\S]*?"tool"[\s\S]*?```/gi,  // Strip JSON blobs with tool
  ];

  for (const msg of messages) {
    const role: MessageRole = msg.info.role === 'user' ? 'user' : 'assistant';
    const roleLabel = role === 'user' ? 'Human' : 'Assistant';

    for (const part of msg.parts) {
      if (part.type === 'text' && 'text' in part) {
        const text = (part as { text: string }).text;

        // Skip parts that contain any injection marker (prevents re-extracting injected content)
        const hasInjectionMarker = injectionMarkers.some(marker => marker.test(text));
        if (hasInjectionMarker) {
          continue; // Skip this part entirely
        }

        // Skip parts that look like tool execution or results
        const hasToolMarker = toolMarkers.some(marker => marker.test(text));
        if (hasToolMarker) {
          continue; // Skip this part entirely
        }

        textLines.push(`${roleLabel}: ${text}`);
        roleLines.push({
          text,
          role,
          lineNumber: textLines.length - 1,
        });
      } else if (part.type === 'tool') {
        const toolPart = part as { tool?: string; state?: { status?: string; output?: string; error?: string } };
        if (toolPart.state?.status === 'completed' || toolPart.state?.status === 'error') {
          const toolText = `Assistant: [Tool: ${toolPart.tool}]`;
          textLines.push(toolText);
          roleLines.push({
            text: toolText,
            role: 'assistant',
            lineNumber: textLines.length - 1,
          });

          if (toolPart.state.output) {
            const outputText = `Tool Result: ${toolPart.state.output.slice(0, 2000)}`;
            textLines.push(outputText);
            roleLines.push({
              text: outputText,
              role: 'assistant',
              lineNumber: textLines.length - 1,
            });
          }
          if (toolPart.state.error) {
            const errorText = `Tool Error: ${toolPart.state.error}`;
            textLines.push(errorText);
            roleLines.push({
              text: errorText,
              role: 'assistant',
              lineNumber: textLines.length - 1,
            });
          }
        }
      }
    }
  }

  return {
    text: textLines.join('\n'),
    lines: roleLines,
  };
}

async function getRelevantMemories(state: TrueMemoryAdapterState, limit: number, query?: string): Promise<MemoryUnit[]> {
  if (query) {
    // Generate embedding for query and use vector search
    const embedding = await embed(query);
    return state.db.vectorSearch(embedding, state.worktree, limit);
  } else {
    // Fall back to scope-based retrieval
    return state.db.getMemoriesByScope(state.worktree, limit);
  }
}

function formatMemoriesForInjection(memories: MemoryUnit[], currentProject?: string): string {
  const lines: string[] = ['## Relevant Memories from Previous Sessions', ''];
  
  const userLevelClassifications = ['constraint', 'preference', 'learning', 'procedural'];
  const userLevel = memories.filter(m => userLevelClassifications.includes(m.classification));
  const projectLevel = memories.filter(m => !userLevelClassifications.includes(m.classification));
  
  if (userLevel.length > 0) {
    lines.push('### User Preferences & Constraints');
    lines.push('_These apply across all projects_');
    lines.push('');
    for (const mem of userLevel) {
      const storeLabel = mem.store === 'ltm' ? '[LTM]' : '[STM]';
      lines.push(`- ${storeLabel} [${mem.classification}] ${mem.summary}`);
    }
    lines.push('');
  }
  
  if (projectLevel.length > 0) {
    const projectName = currentProject ? currentProject.split(/[/\\]/).pop() : 'Current Project';
    lines.push(`### ${projectName} Context`);
    lines.push('');
    for (const mem of projectLevel) {
      const storeLabel = mem.store === 'ltm' ? '[LTM]' : '[STM]';
      lines.push(`- ${storeLabel} [${mem.classification}] ${mem.summary}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

async function injectContext(state: TrueMemoryAdapterState, sessionId: string, context: string): Promise<void> {
  try {
    await state.client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: context }],
      },
    });
  } catch (error) {
    log(`Failed to inject context: ${error}`);
  }
}

function buildCompactionPrompt(memoriesMarkdown: string | null): string {
  const sections: string[] = [];
  
  if (memoriesMarkdown) {
    sections.push(memoriesMarkdown);
  }
  
  sections.push(`## Compaction Instructions

You are compacting a conversation. Preserve:

### MUST PRESERVE
- Current task/goal
- User constraints, preferences, requirements
- Decisions and rationale
- Errors and solutions
- Files modified and why
- Current state of in-progress work

### CAN DISCARD
- Verbose tool outputs (summarize)
- Intermediate reasoning
- Exploratory discussions
- Repetitive information

### OUTPUT FORMAT
Write a structured summary: task, accomplishments, remaining work, critical context.`);
  
  return sections.join('\n\n');
}

export default createTrueMemoryPlugin;
