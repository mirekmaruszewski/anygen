/** Server-Sent Events fallback to the WebSocket: replays past events, then streams live ones. */
export default defineApiHandler(async (event) => {
  const { runs } = useAnyGen()
  const id = getRouterParam(event, 'id')!
  const record = runs.get(id) ?? notFound('Run')

  const stream = createEventStream(event)
  const push = (data: unknown) => stream.push(JSON.stringify(data))

  const off = runs.subscribe(id, (e) => {
    void push(e)
    if (e.type === 'run:done') void stream.close()
  })
  if (!off) {
    // Run is no longer held in memory (older run): report its stored outcome instead.
    await push({ type: 'run:done', runId: id, status: record.status, results: record.results })
    await stream.close()
  } else {
    stream.onClosed(off)
  }
  return stream.send()
})
