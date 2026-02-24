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
import { handleReconsolidation, isRelevant } from '../memory/reconsolidate.js';
import { log } from '../logger.js';

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

    try {
      const dbPath = resolveDbPath(this.config.dbPath);
      ensureDbDirectory(dbPath);
      this.db = await createDatabase(dbPath);

      // Set WAL mode (safe - fallback to delete mode if fails)
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
        log('Database WAL mode enabled successfully');
      } catch (walError) {
        log('Warning: Failed to enable WAL mode, continuing with DELETE mode', walError);
        // WAL mode can fail on some network drives or special filesystems
        // The database will continue to work with DELETE journal mode
      }

      this.initializeSchema();
      this.initialized = true;
      log('Database initialized successfully');
    } catch (error) {
      log('Failed to initialize database', error);
      throw new Error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call await db.init() first.');
    }
  }

  private initializeSchema(): void {
    // Create schema_version table first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    // Check if schema_version table has any records
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM schema_version').get() as { count: number };
    let currentVersion = 0;

    if (countRow.count > 0) {
      // Get current version only if table has records
      const row = this.db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
      currentVersion = row?.version ?? 0;
    }

    log(`Database schema version: ${currentVersion}`);

    // If version is 0, apply the full consolidated schema
    if (currentVersion === 0) {
      this.db.exec('BEGIN TRANSACTION');

      try {
        log('Applying full schema...');
        this.db.exec(`
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

          -- Memory units table (WITH embedding column)
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
            embedding BLOB,

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

        // Record schema version
        this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          1,
          new Date().toISOString()
        );

        this.db.exec('COMMIT');
        log('Schema initialized successfully');
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
          log('Schema initialization failed, transaction rolled back', error);
        } catch (rollbackError) {
          log('Failed to rollback transaction after error', rollbackError);
        }
        throw error;
      }
    } else {
      log('Schema already initialized, skipping');
    }
  }

  // Session Operations
  createSession(id: string, project: string, metadata?: Record<string, unknown>, transcriptPath?: string): Session {
    this.ensureInit();

    const session: Session = {
      id,
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
  async createMemory(
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
      embedding: Float32Array;
    }> = {}
  ): Promise<MemoryUnit> {
    this.ensureInit();

    // Begin transaction for reconsolidation and insertion
    this.db.exec('BEGIN TRANSACTION');

    try {
      // Phase 7: Reconsolidation - Check for similar memories using Jaccard similarity
      const similarMemories = await this.vectorSearch(summary, features.projectScope, 1);

      if (similarMemories.length > 0) {
        const existingMemory = similarMemories[0];
        if (existingMemory) {
          const similarity = this.jaccardSimilarity(summary, existingMemory.summary);

          if (isRelevant(similarity)) {
            // Call reconsolidation logic
            const newMemoryData = {
              store,
              classification,
              summary,
              sourceEventIds,
              projectScope: features.projectScope,
              sessionId: features.sessionId,
            };

            const action = await handleReconsolidation(this, newMemoryData, existingMemory, similarity);

            switch (action.type) {
              case 'duplicate':
                // Increment frequency and return updated memory (no new insert)
                this.db.exec('COMMIT');
                return action.updatedMemory;

              case 'conflict':
                // Delete existing, proceed with insert of new memory
                this.db.prepare(`DELETE FROM memory_units WHERE id = ?`).run(existingMemory.id);
                break;

              case 'complement':
                // Proceed with normal insert
                break;
            }
          }
        }
      }

      // Proceed with normal memory creation
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
        embedding: undefined,
      };

      this.db.prepare(`
        INSERT INTO memory_units (
          id, session_id, store, classification, summary, source_event_ids, project_scope,
          created_at, updated_at, last_accessed_at,
          recency, frequency, importance, utility, novelty, confidence, interference,
          strength, decay_rate, tags, associations, status, version, embedding
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        memory.version,
        null
      );

      this.db.exec('COMMIT');
      return memory;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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

  /**
   * Jaccard similarity search (replaces vector embeddings)
   * Returns top-k memories sorted by Jaccard similarity to query text
   *
   * @param queryText - Text to search for (can be empty Float32Array for backward compatibility)
   * @param currentProject - Current project scope
   * @param limit - Maximum number of results
   */
  async vectorSearch(queryTextOrEmbedding: Float32Array | string, currentProject?: string, limit: number = 10): Promise<MemoryUnit[]> {
    this.ensureInit();

    // Handle both string query and Float32Array (for backward compatibility)
    const queryText = typeof queryTextOrEmbedding === 'string'
      ? queryTextOrEmbedding
      : (queryTextOrEmbedding.length === 0 ? '' : ''); // If embedding is empty, use empty query

    // Fetch all active memories for the current scope
    const userLevelClassifications = ['constraint', 'preference', 'learning', 'procedural'];
    const userClassPlaceholders = userLevelClassifications.map(() => '?').join(', ');

    const query = `
      SELECT * FROM memory_units
      WHERE status = 'active'
      AND (
        classification IN (${userClassPlaceholders})
        OR (project_scope IS NOT NULL AND project_scope = ?)
      )
      LIMIT 1000
    `;
    const params: any[] = [...userLevelClassifications, currentProject ?? ''];

    const rows = this.db.prepare(query).all(...params) as any[];
    const memories = rows.map(this.rowToMemoryUnit.bind(this));

    // Calculate Jaccard similarity for each memory
    const results = memories
      .map((memory) => {
        const similarity = this.jaccardSimilarity(queryText, memory.summary);
        return { memory, similarity };
      });

    // Sort by similarity (descending) and return top-k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit).map((r) => r.memory);
  }

  /**
   * Calculate Jaccard similarity between two texts
   * Jaccard = |intersection| / |union|
   */
  private jaccardSimilarity(text1: string, text2: string): number {
    const tokenize = (text: string): Set<string> => {
      const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 0);
      return new Set(words);
    };

    const set1 = tokenize(text1);
    const set2 = tokenize(text2);

    if (set1.size === 0 || set2.size === 0) {
      return 0;
    }

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
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
      embedding: undefined,
    };
  }

  close(): void {
    try {
      if (!this.db) {
        log('Database already closed or not initialized');
        return;
      }
      
      // Close synchronously - no async operations during shutdown
      // Ignore errors - Bun/OS will clean up file handles on exit
      this.db.close();
      this.initialized = false;
      log('Database connection closed');
    } catch (error) {
      // Silently ignore errors during shutdown
      // The OS will clean up file handles and WAL files
      log('Database close error (ignored during shutdown)');
    }
  }
}

export async function createMemoryDatabase(config: Partial<PsychMemConfig> = {}): Promise<MemoryDatabase> {
  const db = new MemoryDatabase(config);
  await db.init();
  return db;
}
