export default defineApiHandler((event) => {
  return useAnyGen().workflows.get(getRouterParam(event, 'id')!) ?? notFound('Workflow')
})
