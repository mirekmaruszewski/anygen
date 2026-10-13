const MAX_BYTES = 100 * 1024 * 1024

/** Multipart upload: the first part that carries a file is stored. Returns the AssetRef. */
export default defineApiHandler(async (event) => {
  const parts = (await readMultipartFormData(event)) ?? []
  const file = parts.find((p) => p.filename !== undefined)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'Expected a multipart file upload' })
  }
  if (file.data.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'File too large (max 100 MB)' })
  }
  const ref = await useAnyGen().assets.save(new Uint8Array(file.data), {
    name: file.filename ?? 'upload',
    mime: file.type ?? 'application/octet-stream',
  })
  setResponseStatus(event, 201)
  return ref
})
