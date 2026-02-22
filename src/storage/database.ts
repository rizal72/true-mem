/**
 * True-Memory Database Layer
 * SQLite with runtime-agnostic adapter (supports Node.js + Bun)
 */

import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type {
  Session,
  Event,
  MemoryUnit,
  MemoryStore,
  MemoryClassification,
  MemoryStatus,
  HookType,
  PsychMemConfig,
} from '../types.js';
import { DEFAULT_CONFIG } from '../config.js';
import { createDatabase, type SqliteDatabase } from './sqlite-adapter.js';

/**
 * Resolve database path, expanding ~ to home directory
 */
function resolveDbPath(dbPath: string): string {
  if (dbPath.startsWith('~/')) {
    return join(homedir(), dbPath.slice(2));
  }
  return dbPath;
}

/**
 * Ensure parent directory exists for database file
 */
function ensureDbDirectory(dbPath: string): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export class MemoryDatabase {
  private db!: SqliteDatabase;
  private config: PsychMemConfig;
  private initialized: boolean = false;
  private _inTransaction: boolean = false;

  constructor(config: Partial<PsychMemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize database (must be called before use)
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dbPath = resolveDbPath(this.config.dbPath);
    ensureDbDirectory(dbPath);
    this.db = await createDatabase(dbPath);

    // Set WAL mode
    this.db.exec('PRAGMA journal_mode = WAL');

    this.initializeSchema();
    this.initialized = true;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call await db.init() first.');
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      -- Schema version table
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT,
        transcript_path TEXT,
        transcript_watermark INTEGER DEFAULT 0,
        message_watermark INTEGER DEFAULT 0
      );

      -- Events table (raw hook events)
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        hook_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Memory units table
      CREATE TABLE IF NOT EXISTS memory_units (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        store TEXT NOT NULL,
        classification TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_event_ids TEXT NOT NULL,
        project_scope TEXT,

        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,

        recency REAL NOT NULL DEFAULT 0,
        frequency INTEGER NOT NULL DEFAULT 1,
        importance REAL NOT NULL DEFAULT 0.5,
        utility REAL NOT NULL DEFAULT 0.5,
        novelty REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        interference REAL NOT NULL DEFAULT 0,

        strength REAL NOT NULL DEFAULT 0.5,
        decay_rate REAL NOT NULL,

        tags TEXT,
        associations TEXT,

        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,

        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memory_store ON memory_units(store);
      CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_units(status);
      CREATE INDEX IF NOT EXISTS idx_memory_strength ON memory_units(strength);
      CREATE INDEX IF NOT EXISTS idx_memory_classification ON memory_units(classification);
      CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_units(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_project_scope ON memory_units(project_scope);
      CREATE INDEX IF NOT EXISTS idx_memory_status_strength ON memory_units(status, strength);
    `);

    // Schema version check
    const SCHEMA_VERSION = 1;
    const row = this.db.prepare('SELECT version FROM schema_version ORDER BY rowid DESC LIMIT 1').get() as { version: number } | undefined;
    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  // Session Operations
  createSession(project: string, metadata?: Record<string, unknown>, transcriptPath?: string): Session {
    this.ensureInit();

    const session: Session = {
      id: uuidv4(),
      project,
      startedAt: new Date(),
      status: 'active',
      metadata,
      transcriptPath,
      transcriptWatermark: 0,
      messageWatermark: 0,
    };

    this.db.prepare(`
      INSERT INTO sessions (id, project, started_at, status, metadata, transcript_path, transcript_watermark, message_watermark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.project,
      session.startedAt.toISOString(),
      session.status,
      metadata ? JSON.stringify(metadata) : null,
      transcriptPath ?? null,
      0,
      0
    );

    return session;
  }

  endSession(sessionId: string, status: 'completed' | 'abandoned' = 'completed'): void {
    this.ensureInit();
    this.db.prepare(`UPDATE sessions SET ended_at = ?, status = ? WHERE id = ?`).run(new Date().toISOString(), status, sessionId);
  }

  getSession(sessionId: string): Session | null {
    this.ensureInit();
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  getMessageWatermark(sessionId: string): number {
    this.ensureInit();
    const row = this.db.prepare(`SELECT message_watermark FROM sessions WHERE id = ?`).get(sessionId) as any;
    return row?.message_watermark ?? 0;
  }

  updateMessageWatermark(sessionId: string, watermark: number): void {
    this.ensureInit();
    this.db.prepare(`UPDATE sessions SET message_watermark = ? WHERE id = ?`).run(watermark, sessionId);
  }

  // Event Operations
  createEvent(
    sessionId: string,
    hookType: HookType,
    content: string,
    options?: { toolName?: string; toolInput?: string; toolOutput?: string; metadata?: Record<string, unknown> }
  ): Event {
    this.ensureInit();

    const event: Event = {
      id: uuidv4(),
      sessionId,
      hookType,
      timestamp: new Date(),
      content,
      toolName: options?.toolName,
      toolInput: options?.toolInput,
      toolOutput: options?.toolOutput,
      metadata: options?.metadata,
    };

    this.db.prepare(`
      INSERT INTO events (id, session_id, hook_type, timestamp, content, tool_name, tool_input, tool_output, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.sessionId,
      event.hookType,
      event.timestamp.toISOString(),
      event.content,
      event.toolName ?? null,
      event.toolInput ?? null,
      event.toolOutput ?? null,
      event.metadata ? JSON.stringify(event.metadata) : null
    );

    return event;
  }

  getSessionEvents(sessionId: string): Event[] {
    this.ensureInit();
    const rows = this.db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`).all(sessionId) as any[];
    return rows.map(this.rowToEvent);
  }

  // Memory Operations
  createMemory(
    store: MemoryStore,
    classification: MemoryClassification,
    summary: string,
    sourceEventIds: string[],
    features: Partial<{
      sessionId: string;
      projectScope: string;
      importance: number;
      utility: number;
      novelty: number;
      confidence: number;
      tags: string[];
    }> = {}
  ): MemoryUnit {
    this.ensureInit();

    const now = new Date();
    const decayRate = store === 'stm' ? this.config.stmDecayRate : this.config.ltmDecayRate;

    const memory: MemoryUnit = {
      id: uuidv4(),
      sessionId: features.sessionId,
      store,
      classification,
      summary,
      sourceEventIds,
      projectScope: features.projectScope,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      recency: 0,
      frequency: 1,
      importance: features.importance ?? 0.5,
      utility: features.utility ?? 0.5,
      novelty: features.novelty ?? 0.5,
      confidence: features.confidence ?? 0.5,
      interference: 0,
      strength: this.calculateStrength({
        recency: 0,
        frequency: 1,
        importance: features.importance ?? 0.5,
        utility: features.utility ?? 0.5,
        novelty: features.novelty ?? 0.5,
        confidence: features.confidence ?? 0.5,
        interference: 0,
      }),
      decayRate,
      tags: features.tags ?? [],
      associations: [],
      status: 'active',
      version: 1,
      evidence: [],
    };

    this.db.prepare(`
      INSERT INTO memory_units (
        id, session_id, store, classification, summary, source_event_ids, project_scope,
        created_at, updated_at, last_accessed_at,
        recency, frequency, importance, utility, novelty, confidence, interference,
        strength, decay_rate, tags, associations, status, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.sessionId ?? null,
      memory.store,
      memory.classification,
      memory.summary,
      JSON.stringify(memory.sourceEventIds),
      memory.projectScope ?? null,
      memory.createdAt.toISOString(),
      memory.updatedAt.toISOString(),
      memory.lastAccessedAt.toISOString(),
      memory.recency,
      memory.frequency,
      memory.importance,
      memory.utility,
      memory.novelty,
      memory.confidence,
      memory.interference,
      memory.strength,
      memory.decayRate,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.associations),
      memory.status,
      memory.version
    );

    return memory;
  }

  getMemory(memoryId: string): MemoryUnit | null {
    this.ensureInit();
    const row = this.db.prepare(`SELECT * FROM memory_units WHERE id = ?`).get(memoryId) as any;
    if (!row) return null;
    return this.rowToMemoryUnit(row);
  }

  getMemoriesByScope(currentProject?: string, limit: number = 20, store?: MemoryStore): MemoryUnit[] {
    this.ensureInit();

    const userLevelClassifications = ['constraint', 'preference', 'learning', 'procedural'];
    const userClassPlaceholders = userLevelClassifications.map(() => '?').join(', ');

    let query = `
      SELECT * FROM memory_units
      WHERE status = 'active'
      AND (
        classification IN (${userClassPlaceholders})
        OR (project_scope IS NOT NULL AND project_scope = ?)
      )
    `;
    const params: any[] = [...userLevelClassifications, currentProject ?? ''];

    if (store) {
      query += ` AND store = ?`;
      params.push(store);
    }

    query += ` ORDER BY strength DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(this.rowToMemoryUnit.bind(this));
  }

  updateMemoryStrength(memoryId: string, strength: number): void {
    this.ensureInit();
    this.db.prepare(`UPDATE memory_units SET strength = ?, updated_at = ? WHERE id = ?`).run(strength, new Date().toISOString(), memoryId);
  }

  updateMemoryStatus(memoryId: string, status: MemoryStatus): void {
    this.ensureInit();
    this.db.prepare(`UPDATE memory_units SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), memoryId);
  }

  incrementFrequency(memoryId: string): void {
    this.ensureInit();
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE memory_units SET frequency = frequency + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, memoryId);
  }

  promoteToLtm(memoryId: string): void {
    this.ensureInit();
    this.db.prepare(`UPDATE memory_units SET store = 'ltm', decay_rate = ?, updated_at = ? WHERE id = ?`).run(this.config.ltmDecayRate, new Date().toISOString(), memoryId);
  }

  // Scoring
  calculateStrength(features: {
    recency: number;
    frequency: number;
    importance: number;
    utility: number;
    novelty: number;
    confidence: number;
    interference: number;
  }): number {
    const w = this.config.scoringWeights;

    const normalizedFrequency = Math.min(1, Math.log(features.frequency + 1) / Math.log(10));
    const recencyFactor = 1 - Math.min(1, features.recency / 168);

    const strength =
      w.recency * recencyFactor +
      w.frequency * normalizedFrequency +
      w.importance * features.importance +
      w.utility * features.utility +
      w.novelty * features.novelty +
      w.confidence * features.confidence +
      w.interference * features.interference;

    return Math.max(0, Math.min(1, strength));
  }

  // Decay
  applyDecay(): number {
    this.ensureInit();
    const now = new Date();
    const memories = this.db.prepare(`SELECT id, strength, decay_rate, updated_at, status, classification FROM memory_units WHERE status = 'active'`).all() as any[];

    let decayedCount = 0;
    const decayThreshold = this.config.decayThreshold ?? 0.1;
    const onlyEpisodic = this.config.applyDecayOnlyToEpisodic ?? false;

    for (const mem of memories) {
      // True-Memory improvement: skip non-episodic if configured
      if (onlyEpisodic && mem.classification !== 'episodic') {
        continue;
      }

      const updatedAt = new Date(mem.updated_at);
      const dtHours = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
      const newStrength = mem.strength * Math.exp(-mem.decay_rate * dtHours);

      if (newStrength < decayThreshold) {
        this.updateMemoryStatus(mem.id, 'decayed');
        decayedCount++;
      } else if (newStrength !== mem.strength) {
        this.updateMemoryStrength(mem.id, newStrength);
      }
    }

    return decayedCount;
  }

  // Consolidation
  runConsolidation(): number {
    this.ensureInit();
    const stmMemories = this.db.prepare(`SELECT * FROM memory_units WHERE store = 'stm' AND status = 'active'`).all() as any[];
    let promotedCount = 0;

    for (const mem of stmMemories) {
      const memory = this.rowToMemoryUnit(mem);
      const shouldPromote =
        memory.strength >= this.config.stmToLtmStrengthThreshold ||
        memory.frequency >= this.config.stmToLtmFrequencyThreshold ||
        this.config.autoPromoteToLtm.includes(memory.classification);

      if (shouldPromote) {
        this.promoteToLtm(memory.id);
        promotedCount++;
      }
    }

    return promotedCount;
  }

  // Helpers
  private rowToSession(row: any): Session {
    return {
      id: row.id,
      project: row.project,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      transcriptPath: row.transcript_path ?? undefined,
      transcriptWatermark: row.transcript_watermark ?? 0,
      messageWatermark: row.message_watermark ?? 0,
    };
  }

  private rowToEvent(row: any): Event {
    return {
      id: row.id,
      sessionId: row.session_id,
      hookType: row.hook_type as HookType,
      timestamp: new Date(row.timestamp),
      content: row.content,
      toolName: row.tool_name ?? undefined,
      toolInput: row.tool_input ?? undefined,
      toolOutput: row.tool_output ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToMemoryUnit(row: any): MemoryUnit {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      store: row.store as MemoryStore,
      classification: row.classification as MemoryClassification,
      summary: row.summary,
      sourceEventIds: JSON.parse(row.source_event_ids),
      projectScope: row.project_scope ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastAccessedAt: new Date(row.last_accessed_at),
      recency: row.recency,
      frequency: row.frequency,
      importance: row.importance,
      utility: row.utility,
      novelty: row.novelty,
      confidence: row.confidence,
      interference: row.interference,
      strength: row.strength,
      decayRate: row.decay_rate,
      tags: row.tags ? JSON.parse(row.tags) : [],
      associations: row.associations ? JSON.parse(row.associations) : [],
      status: row.status as MemoryStatus,
      version: row.version,
      evidence: [],
    };
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

export async function createMemoryDatabase(config: Partial<PsychMemConfig> = {}): Promise<MemoryDatabase> {
  const db = new MemoryDatabase(config);
  await db.init();
  return db;
}
