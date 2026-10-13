export default defineApiHandler((event) => {
  const id = getRouterParam(event, 'id')!
  return { runId: id, cancelled: useAnyGen().runs.cancel(id) }
})
