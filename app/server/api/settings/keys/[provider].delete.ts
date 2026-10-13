export default defineApiHandler((event) => {
  const { secrets } = useAnyGen()
  const provider = getRouterParam(event, 'provider')!
  if (!secrets.status().some((p) => p.id === provider)) notFound('Provider')
  secrets.delete(provider)
  return secrets.status().find((p) => p.id === provider)
})
