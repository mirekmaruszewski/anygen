export default defineApiHandler((event) => {
  if (!useAnyGen().workflows.remove(getRouterParam(event, 'id')!)) notFound('Workflow')
  setResponseStatus(event, 204)
  return null
})
