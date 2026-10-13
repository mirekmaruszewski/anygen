export default defineApiHandler(async (event) => {
  const { ref, data } = await useAnyGen().assets.read(getRouterParam(event, 'id')!)
  // Uploaded content is untrusted: never let the browser sniff or run it as part of our origin.
  setHeaders(event, {
    'content-type': ref.mime,
    'content-length': data.byteLength,
    'content-disposition': `inline; filename="${encodeURIComponent(ref.name)}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    'cache-control': 'private, max-age=31536000, immutable',
  })
  return send(event, Buffer.from(data))
})
