import { z } from 'zod'
import { SETTING_KEYS } from '../../lib/settings'

const Body = z
  .object(Object.fromEntries(SETTING_KEYS.map((k) => [k, z.string().nullable().optional()])))
  .strict()

export default defineApiHandler(async (event) => {
  const { settings } = useAnyGen()
  settings.update(await readJson(event, Body))
  return settings.getAll()
})
