import { z } from 'zod'

const Body = z.object({ apiKey: z.string().trim().min(1) })

export default defineApiHandler(async (event) => {
  const { secrets } = useAnyGen()
  const provider = getRouterParam(event, 'provider')!
  if (!secrets.status().some((p) => p.id === provider)) notFound('Provider')
  secrets.set(provider, (await readJson(event, Body)).apiKey)
  return secrets.status().find((p) => p.id === provider)
})
