export default defineApiHandler((event) => {
  return useAnyGen().runs.get(getRouterParam(event, 'id')!) ?? notFound('Run')
})
