import { Pool } from "pg";

declare global {
  var tasklyPool: Pool | undefined;
  var tasklySchemaReady: Promise<void> | undefined;
}

function getPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!globalThis.tasklyPool) {
    globalThis.tasklyPool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA } : {}),
      },
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
  }

  return globalThis.tasklyPool;
}

export async function query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
  text: string,
  values: (string | boolean | null)[] = [],
) {
  const pool = getPool();

  if (!globalThis.tasklySchemaReady) {
    globalThis.tasklySchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          task_date DATE NOT NULL DEFAULT CURRENT_DATE,
          scheduled_time TIME NULL,
          is_completed BOOLEAN NOT NULL DEFAULT FALSE,
          reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          notified_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_session_date
          ON tasks(session_id, task_date);
      `)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalThis.tasklySchemaReady = undefined;
        throw error;
      });
  }

  await globalThis.tasklySchemaReady;
  return pool.query<T>(text, values);
}
