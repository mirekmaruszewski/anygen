import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { resizeImageNode } from '../src/image/resize'
import { run, testContext } from './helpers'

async function source(t: ReturnType<typeof testContext>, w: number, h: number, ch: 3 | 4 = 4) {
  const data = await sharp({
    create: { width: w, height: h, channels: ch, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  })
    .png()
    .toBuffer()
  return t.assets.save(new Uint8Array(data), { name: 'photo.png', mime: 'image/png' })
}

const meta = async (t: ReturnType<typeof testContext>, out: { image: unknown }) => {
  const ref = out.image as { assetId: string; mime: string; name: string }
  const { data } = await t.assets.read(ref.assetId)
  return { ref, info: await sharp(data).metadata() }
}

describe('image/resize', () => {
  it('keeps the aspect ratio when only the width is set', async () => {
    const t = testContext()
    const out = await run(
      resizeImageNode,
      t,
      { image: await source(t, 400, 200) },
      { width: 100, height: 0 },
    )
    const { ref, info } = await meta(t, out as { image: unknown })
    expect([info.width, info.height]).toEqual([100, 50])
    expect(ref.name).toBe('photo-resized.png')
  })

  it('cover crops to the exact box, contain pads to it', async () => {
    const t = testContext()
    const image = await source(t, 400, 200)
    for (const fit of ['cover', 'contain', 'fill']) {
      const out = await run(resizeImageNode, t, { image }, { width: 100, height: 100, fit })
      const { info } = await meta(t, out as { image: unknown })
      expect([info.width, info.height]).toEqual([100, 100])
    }
  })

  it('inputs override params and upscaling can be disabled', async () => {
    const t = testContext()
    const image = await source(t, 40, 20)
    const out = await run(
      resizeImageNode,
      t,
      { image, width: 200 },
      { width: 10, allowUpscale: false },
    )
    expect((await meta(t, out as { image: unknown })).info.width).toBe(40)
  })

  it('converts format', async () => {
    const t = testContext()
    const out = await run(
      resizeImageNode,
      t,
      { image: await source(t, 40, 20) },
      { width: 20, format: 'jpeg' },
    )
    const { ref, info } = await meta(t, out as { image: unknown })
    expect(ref.mime).toBe('image/jpeg')
    expect(info.format).toBe('jpeg')
  })

  it('rejects missing size and non-image assets', async () => {
    const t = testContext()
    const image = await source(t, 10, 10)
    await expect(run(resizeImageNode, t, { image }, { width: 0, height: 0 })).rejects.toThrow(
      'width or a height',
    )
    await expect(run(resizeImageNode, t, {}, { width: 10 })).rejects.toThrow('No image')
  })
})
