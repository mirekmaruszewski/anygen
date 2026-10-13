import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workflows (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  graph      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT,
  status      TEXT NOT NULL,
  graph       TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_workflow ON runs (workflow_id, started_at);

CREATE TABLE IF NOT EXISTS run_node_results (
  run_id      TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  node_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  outputs     TEXT,
  error       TEXT,
  cached      INTEGER NOT NULL DEFAULT 0,
  blocked_by  TEXT,
  finished_at TEXT NOT NULL,
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Opens (creating if needed) the SQLite database. Pass `:memory:` for tests. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  // Runs left "running" by a previous process can never finish.
  db.prepare("UPDATE runs SET status = 'cancelled', finished_at = ? WHERE status = 'running'").run(
    new Date().toISOString(),
  )
  return db
}
