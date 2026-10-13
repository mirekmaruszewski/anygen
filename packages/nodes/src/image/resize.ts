import sharp from 'sharp'
import { defineNode } from '@anygen/core'
import { readAsset, saveAsset, extForMime } from '../util/assets'

const FORMATS = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const
type Format = keyof typeof FORMATS

const MIME_FORMAT: Record<string, Format> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
}

/** A positive pixel count, or undefined for "auto" (empty / 0). */
function pixels(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a positive number`)
  return n || undefined
}

export const resizeImageNode = defineNode({
  id: 'image/resize',
  title: 'Resize Image',
  category: 'Image',
  description:
    'Resizes an image locally (no AI model). Set width and/or height in pixels; leave one at 0 to keep the aspect ratio.',
  inputs: [
    { name: 'image', type: 'image' },
    { name: 'width', type: 'number', required: false },
    { name: 'height', type: 'number', required: false },
  ],
  outputs: [{ name: 'image', type: 'image' }],
  params: [
    {
      name: 'width',
      type: 'number',
      label: 'Width (px)',
      description: '0 = automatic. Overridden by the width input when connected.',
      default: 1024,
      min: 0,
      step: 1,
    },
    {
      name: 'height',
      type: 'number',
      label: 'Height (px)',
      description: '0 = automatic. Overridden by the height input when connected.',
      default: 0,
      min: 0,
      step: 1,
    },
    {
      name: 'fit',
      type: 'select',
      label: 'Fit',
      description: 'How to fit the image when both width and height are set.',
      default: 'inside',
      options: [
        { value: 'inside', label: 'inside (keep ratio, fit within box)' },
        { value: 'cover', label: 'cover (keep ratio, crop to fill)' },
        { value: 'contain', label: 'contain (keep ratio, pad to box)' },
        { value: 'fill', label: 'fill (stretch)' },
      ],
    },
    {
      name: 'allowUpscale',
      type: 'boolean',
      label: 'Allow enlarging',
      default: true,
    },
    {
      name: 'format',
      type: 'select',
      label: 'Output format',
      default: 'keep',
      options: ['keep', 'png', 'jpeg', 'webp'],
    },
    {
      name: 'quality',
      type: 'number',
      label: 'Quality (jpeg/webp)',
      default: 90,
      min: 1,
      max: 100,
      step: 1,
    },
  ],
  execute: async (ctx, inputs, params) => {
    const source = await readAsset(ctx, inputs.image, 'image')
    const width = pixels(inputs.width ?? params.width, 'Width')
    const height = pixels(inputs.height ?? params.height, 'Height')
    if (!width && !height) throw new Error('Set a width or a height')

    const fit = String(params.fit ?? 'inside') as 'inside' | 'cover' | 'contain' | 'fill'
    const wanted = String(params.format ?? 'keep')
    const format: Format =
      wanted in FORMATS ? (wanted as Format) : (MIME_FORMAT[source.ref.mime] ?? 'png')
    const quality = Math.min(100, Math.max(1, Math.round(Number(params.quality ?? 90))))

    ctx.progress({ message: 'Resizing image…' })
    let pipeline = sharp(source.data)
      .rotate()
      .resize({
        width,
        height,
        fit,
        withoutEnlargement: params.allowUpscale === false,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
    if (format === 'jpeg') {
      // JPEG has no alpha: flatten any transparency onto white.
      pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality })
    } else if (format === 'webp') pipeline = pipeline.webp({ quality })
    else pipeline = pipeline.png()

    const data = await pipeline.toBuffer()
    const mime = FORMATS[format]
    const base = source.ref.name.replace(/\.[^.]+$/, '') || 'image'
    return {
      image: await saveAsset(ctx, new Uint8Array(data), {
        name: `${base}-resized.${extForMime(mime)}`,
        mime,
      }),
    }
  },
})
