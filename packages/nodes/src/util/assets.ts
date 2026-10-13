import { getServices, isAssetRef, type AssetRef, type ExecutionContext } from '@anygen/core'

type Ctx = Pick<ExecutionContext, 'services'>

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/json': 'json',
  'text/plain': 'txt',
}

export const extForMime = (mime: string) => EXT_BY_MIME[mime] ?? 'bin'

/** Reads an asset input/param, checking it is an `AssetRef` of the expected kind (e.g. `image`). */
export async function readAsset(
  ctx: Ctx,
  value: unknown,
  kind: 'image' | 'audio' | 'video',
  label = kind,
): Promise<{ ref: AssetRef; data: Uint8Array }> {
  if (!isAssetRef(value)) throw new Error(`No ${label} selected`)
  const loaded = await getServices(ctx).assets.read(value.assetId)
  if (!loaded.ref.mime.startsWith(`${kind}/`)) {
    throw new Error(`"${loaded.ref.name}" is ${loaded.ref.mime}, expected ${kind}/*`)
  }
  return loaded
}

export function saveAsset(
  ctx: Ctx,
  data: Uint8Array,
  meta: { name: string; mime: string },
): Promise<AssetRef> {
  return getServices(ctx).assets.save(data, meta)
}

/** Keeps user-supplied file names safe and gives them an extension. */
export function safeFileName(name: unknown, fallback: string, ext: string): string {
  const cleaned = Array.from(String(name ?? ''), (c) =>
    c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '_' : c,
  ).join('')
  const base = cleaned.trim() || fallback
  return /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}.${ext}`
}

/** A user-message part carrying an image (the AI SDK's `image` part type is deprecated). */
export const imagePart = (data: Uint8Array, mediaType: string) =>
  ({ type: 'file', mediaType, data }) as const
