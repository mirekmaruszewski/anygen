import { z } from 'zod'
import { defineNode } from '@anygen/core'
import { runStructured } from '../ai/text'
import { modelParam } from '../llm/chat'
import { imagePart, readAsset } from '../util/assets'

const modelFactsSchema = z.object({
  readable: z
    .boolean()
    .describe('false when the image is too blurry, empty or illegible to extract facts from'),
  facts: z
    .array(z.string())
    .describe('Self-contained factual statements, one per item. Empty when not readable'),
})
type ModelFacts = z.infer<typeof modelFactsSchema>

export const factsExtractorNode = defineNode({
  id: 'quiz/facts-extractor',
  title: 'Facts Extractor',
  category: 'Quiz',
  description:
    'Reads an image (e.g. a book page) with a vision model and lists the facts it states, one per line. Feed the result into Quiz from Facts.',
  inputs: [{ name: 'image', type: 'image' }],
  outputs: [{ name: 'facts', type: 'text' }],
  params: [
    modelParam('anthropic:claude-sonnet-5-5'),
    { name: 'language', type: 'text', label: 'Language', default: '' },
    { name: 'instructions', type: 'textarea', label: 'Extra instructions', default: '' },
  ],
  execute: async (ctx, inputs, params) => {
    const { ref, data } = await readAsset(ctx, inputs.image, 'image')
    const language = String(params.language ?? '').trim()
    const extra = String(params.instructions ?? '').trim()

    const out = await runStructured<ModelFacts>({
      ctx,
      model: String(params.model),
      temperature: 0.2,
      schema: modelFactsSchema,
      validate: (o) => {
        const m = o as ModelFacts
        if (m.readable && !m.facts.some((f) => f.trim())) throw new Error('No facts were produced')
      },
      messages: [
        {
          role: 'user',
          content: [
            imagePart(data, ref.mime),
            {
              type: 'text',
              text: [
                'Read this image and list the facts it states.',
                'Each fact must be a short, self-contained statement that makes sense without the others. Only include what is stated in the image; do not add outside knowledge.',
                `Language: ${language || 'the language of the image'}.`,
                'If the image is unreadable, set readable to false and return no facts.',
                extra ? `Additional instructions: ${extra}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
      ],
    })

    if (!out.readable) {
      throw new Error(`The model could not read "${ref.name}". Try a sharper or better-lit scan.`)
    }
    const facts = out.facts.map((f) => f.trim()).filter(Boolean)
    return { facts: facts.map((f) => `- ${f}`).join('\n') }
  },
})
