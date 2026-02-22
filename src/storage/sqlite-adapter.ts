/**
 * SQLite Adapter - Runtime-agnostic SQLite interface
 *
 * Supports:
 * - bun:sqlite  (Bun runtime)
 * - node:sqlite (Node.js 22+, no native addons required)
 */

// Declare Bun types for runtime detection
declare global {
  // eslint-disable-next-line no-var
  var Bun: { version: string } | undefined;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  pragma?(pragma: string): unknown;
}

/**
 * Detect if running in Bun
 */
export function isBun(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

/**
 * Create a SQLite database connection using the appropriate native driver
 */
export async function createDatabase(dbPath: string): Promise<SqliteDatabase> {
  if (isBun()) {
    return createBunDatabase(dbPath);
  } else {
    return createNodeDatabase(dbPath);
  }
}

/**
 * Create database using bun:sqlite
 */
async function createBunDatabase(dbPath: string): Promise<SqliteDatabase> {
  // @ts-expect-error - bun:sqlite is only available in Bun runtime
  const { Database } = await import('bun:sqlite');
  const db = new Database(dbPath);

  return {
    exec(sql: string): void {
      db.exec(sql);
    },

    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          stmt.run(...params);
          return {
            changes: db.changes as number,
            lastInsertRowid: db.lastInsertRowid as number | bigint,
          };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },

    close(): void {
      db.close();
    },

    pragma(pragma: string): unknown {
      return db.query(`PRAGMA ${pragma}`).get();
    },
  };
}

/**
 * Create database using node:sqlite (Node.js 22+)
 */
async function createNodeDatabase(dbPath: string): Promise<SqliteDatabase> {
  // node:sqlite is synchronous — dynamic import keeps the async adapter signature uniform
  const { DatabaseSync } = await import('node:sqlite' as string);
  const db = new DatabaseSync(dbPath);

  return {
    exec(sql: string): void {
      db.exec(sql);
    },

    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          const result = stmt.run(...params);
          return {
            changes: result.changes as number,
            lastInsertRowid: result.lastInsertRowid as number | bigint,
          };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },

    close(): void {
      db.close();
    },

    pragma(pragma: string): unknown {
      return db.prepare(`PRAGMA ${pragma}`).get();
    },
  };
}
