/**
 * True-Memory OpenCode Adapter
 */

import type { PluginInput, Hooks, Event, Message, Part } from '../../types.js';
import type { PsychMemConfig, MemoryUnit } from '../../types.js';
import { DEFAULT_CONFIG } from '../../config.js';
import { MemoryDatabase, createMemoryDatabase } from '../../storage/database.js';
import { log } from '../../logger.js';

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
          await handleSessionIdle(state, sessionId);
          break;
        case 'session.deleted':
        case 'session.error':
          await handleSessionEnd(state, event.type, sessionId);
          break;
        case 'message.updated':
          if (state.config.opencode.extractOnMessage) {
            await handleMessageUpdated(state, event.properties);
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

// Session handlers
async function handleSessionCreated(
  state: TrueMemoryAdapterState,
  sessionId?: string
): Promise<void> {
  if (!sessionId) return;
  
  state.currentSessionId = sessionId;
  state.injectedSessions.add(sessionId);
  log(`Session created: ${sessionId}`);
  
  // Create session in DB
  state.db.createSession(state.worktree, { agentType: 'opencode' });
  
  // Inject memories
  const memories = await getRelevantMemories(state, state.config.opencode.maxSessionStartMemories);
  
  if (memories.length > 0) {
    const memoryContext = formatMemoriesForInjection(memories, state.worktree);
    await injectContext(state, sessionId, memoryContext);
    log(`Injected ${memories.length} memories on session start`);
  }
}

async function handleSessionIdle(
  state: TrueMemoryAdapterState,
  sessionId?: string
): Promise<void> {
  const effectiveSessionId = sessionId ?? state.currentSessionId;
  if (!effectiveSessionId) return;
  
  if (sessionId && !state.currentSessionId) {
    state.currentSessionId = sessionId;
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
  const conversationText = extractConversationText(newMessages);
  
  if (!conversationText.trim()) {
    state.db.updateMessageWatermark(effectiveSessionId, messages.length);
    return;
  }
  
  // Extract memories (simplified)
  log(`Processing ${newMessages.length} new messages`);
  state.db.updateMessageWatermark(effectiveSessionId, messages.length);
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
  const info = eventProps?.info as { sessionID?: string; role?: string } | undefined;
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
    
    const memories = await getRelevantMemories(state, state.config.opencode.maxSessionStartMemories);
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
function extractConversationText(messages: MessageContainer[]): string {
  const lines: string[] = [];
  
  for (const msg of messages) {
    const role = msg.info.role === 'user' ? 'Human' : 'Assistant';
    
    for (const part of msg.parts) {
      if (part.type === 'text' && 'text' in part) {
        lines.push(`${role}: ${(part as { text: string }).text}`);
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

async function getRelevantMemories(state: TrueMemoryAdapterState, limit: number): Promise<MemoryUnit[]> {
  return state.db.getMemoriesByScope(state.worktree, limit);
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
