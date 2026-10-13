import { defineNode } from '@anygen/core'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body.charAt(1).toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

const BLOCK_TAGS =
  'address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|tr|ul'

/** Converts HTML to readable plain text: no tags, scripts or styles; block elements become paragraphs. */
export function htmlToText(html: string, opts: { keepLinks?: boolean } = {}): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, '')
  if (opts.keepLinks) {
    s = s.replace(
      /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_m, dq: string | undefined, sq: string | undefined, label: string) => {
        const href = decodeEntities((dq ?? sq ?? '').trim())
        const plain = label.replace(/<[^>]*>/g, '').trim()
        return !href || href.startsWith('#') || href === plain ? label : `${label} (${href})`
      },
    )
  }
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(s)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const htmlToTextNode = defineNode({
  id: 'core/html-to-text',
  title: 'HTML to Text',
  category: 'Utility',
  description:
    'Strips HTML down to readable plain text (drops scripts and styles, keeps paragraphs and lists, decodes entities).',
  inputs: [{ name: 'html', type: 'text' }],
  outputs: [{ name: 'text', type: 'text' }],
  params: [
    {
      name: 'keepLinks',
      type: 'boolean',
      label: 'Keep link URLs',
      description: 'Render links as "label (url)".',
      default: false,
    },
  ],
  execute: (_ctx, inputs, params) => ({
    text: htmlToText(String(inputs.html ?? ''), { keepLinks: params.keepLinks === true }),
  }),
})
