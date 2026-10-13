import type { Db } from './db'

/** Non-secret settings the editor may change. Anything else is rejected. */
export const SETTING_KEYS = ['ollamaBaseUrl', 'lmstudioBaseUrl'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

export function createSettingsStore(db: Db) {
  const isKey = (key: string): key is SettingKey =>
    (SETTING_KEYS as readonly string[]).includes(key)

  return {
    getAll(): Partial<Record<SettingKey, string>> {
      const out: Partial<Record<SettingKey, string>> = {}
      for (const key of SETTING_KEYS) {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
          { value: string } | undefined
        if (row) out[key] = row.value
      }
      return out
    },

    update(values: Partial<Record<SettingKey, string | null>>) {
      for (const [key, value] of Object.entries(values)) {
        if (!isKey(key)) throw new Error(`Unknown setting "${key}"`)
        if (value === null || value === '')
          db.prepare('DELETE FROM settings WHERE key = ?').run(key)
        else
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
      }
    },
  }
}

export type SettingsStore = ReturnType<typeof createSettingsStore>
