import { randomUUID } from 'node:crypto'
import type { Graph } from '@anygen/core'
import type { Db } from './db'

export interface WorkflowSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Workflow extends WorkflowSummary {
  graph: Graph
}

interface Row {
  id: string
  name: string
  graph: string
  created_at: string
  updated_at: string
}

const summary = (r: Row): WorkflowSummary => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const full = (r: Row): Workflow => ({ ...summary(r), graph: JSON.parse(r.graph) as Graph })

export function createWorkflowStore(db: Db) {
  const get = (id: string): Workflow | undefined => {
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as unknown as
      Row | undefined
    return row && full(row)
  }

  return {
    list(): WorkflowSummary[] {
      const rows = db
        .prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
        .all() as unknown as Row[]
      return rows.map(summary)
    },

    get,

    create(input: { name: string; graph: Graph }): Workflow {
      const now = new Date().toISOString()
      const id = randomUUID()
      db.prepare(
        'INSERT INTO workflows (id, name, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, input.name, JSON.stringify(input.graph), now, now)
      return get(id)!
    },

    update(id: string, input: { name?: string; graph?: Graph }): Workflow | undefined {
      const current = get(id)
      if (!current) return undefined
      db.prepare('UPDATE workflows SET name = ?, graph = ?, updated_at = ? WHERE id = ?').run(
        input.name ?? current.name,
        JSON.stringify(input.graph ?? current.graph),
        new Date().toISOString(),
        id,
      )
      return get(id)
    },

    remove(id: string): boolean {
      return Number(db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes) > 0
    },
  }
}

export type WorkflowStore = ReturnType<typeof createWorkflowStore>
