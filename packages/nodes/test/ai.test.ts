import { describe, expect, it } from 'vitest'
import { chatNode, visionNode } from '../src/llm/chat'
import { structuredOutputNode, visionStructuredNode } from '../src/llm/structured'
import { createModelResolver, lmstudioBaseUrl, ollamaBaseUrl } from '../src/ai/models'
import { factsExtractorNode } from '../src/quiz/facts'
import { quizFromFactsNode } from '../src/quiz/node'
import { buildQuiz, checkQuiz, type ModelQuiz } from '../src/quiz/quiz'
import { memoryAssets, mockLanguageModel, PNG, run, testContext } from './helpers'

const goodQuiz = (): ModelQuiz => ({
  title: 'Photosynthesis',
  language: 'en',
  questions: [
    {
      type: 'open',
      question: 'What do plants absorb?',
      answer: 'Carbon dioxide',
      acceptedAnswers: ['CO2', ' CO2 ', ''],
      options: [],
      correctOptions: [],
      explanation: 'They take it in through stomata.',
    },
    {
      type: 'multiselect',
      question: 'Which are products?',
      answer: '',
      acceptedAnswers: [],
      options: ['Oxygen', 'Glucose', 'Helium'],
      correctOptions: [0, 1],
      explanation: '',
    },
  ],
})

describe('chat and vision', () => {
  it('streams text and reports partial output', async () => {
    const { model } = mockLanguageModel(['Hello brave new world'])
    const t = testContext({ model })
    const out = await run(chatNode, t, { model: 'anthropic:x', prompt: 'hi' })
    expect(out.text).toBe('Hello brave new world')
    expect(t.progress.at(-1)?.partial).toBe('Hello brave new world')
  })

  it('sends the image as an image part', async () => {
    const { model, prompts } = mockLanguageModel(['A cat.'])
    const t = testContext({ model })
    const image = await t.assets.save(PNG, { name: 'p.png', mime: 'image/png' })
    expect(
      (await run(visionNode, t, { model: 'test:model', image, prompt: 'What is this?' })).text,
    ).toBe('A cat.')
    const user = (
      prompts[0] as { role: string; content: { type: string; mediaType?: string }[] }[]
    ).find((m) => m.role === 'user')!
    expect(user.content.map((p) => p.type)).toEqual(['file', 'text'])
    expect(user.content[0]!.mediaType).toBe('image/png')
  })

  it('rejects a non-image input before calling the model', async () => {
    const { model, calls } = mockLanguageModel(['x'])
    const t = testContext({ model })
    const doc = await t.assets.save(new Uint8Array([1]), { name: 'd.pdf', mime: 'application/pdf' })
    await expect(
      run(visionNode, t, { model: 'test:model', image: doc, prompt: 'p' }),
    ).rejects.toThrow(/expected image/)
    expect(calls()).toBe(0)
  })
})

describe('structured output', () => {
  const schema = {
    type: 'object',
    properties: { n: { type: 'number' } },
    required: ['n'],
    additionalProperties: false,
  }

  it('returns schema-valid JSON', async () => {
    const { model } = mockLanguageModel(['{"n": 3}'])
    const out = await run(
      structuredOutputNode,
      testContext({ model }),
      { model: 'test:model', prompt: 'p' },
      { schema },
    )
    expect(out.json).toEqual({ n: 3 })
  })

  it('retries once when the output does not match the schema', async () => {
    const { model, calls } = mockLanguageModel(['{"n": "three"}', '{"n": 3}'])
    const out = await run(
      structuredOutputNode,
      testContext({ model }),
      { model: 'test:model', prompt: 'p' },
      { schema },
    )
    expect(out.json).toEqual({ n: 3 })
    expect(calls()).toBe(2)
  })

  it('gives up after the retry', async () => {
    const { model, calls } = mockLanguageModel(['nope'])
    await expect(
      run(
        structuredOutputNode,
        testContext({ model }),
        { model: 'test:model', prompt: 'p' },
        { schema },
      ),
    ).rejects.toThrow()
    expect(calls()).toBe(2)
  })

  it('reports an invalid schema param clearly', async () => {
    const t = testContext({ model: mockLanguageModel(['{}']).model })
    await expect(
      run(structuredOutputNode, t, { model: 'test:model', prompt: 'p' }, { schema: '{oops' }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it('reads images', async () => {
    const { model } = mockLanguageModel(['{"n": 1}'])
    const t = testContext({ model })
    const image = await t.assets.save(PNG, { name: 'p.png', mime: 'image/png' })
    const out = await run(
      visionStructuredNode,
      t,
      { model: 'test:model', image, prompt: 'count' },
      { schema },
    )
    expect(out.json).toEqual({ n: 1 })
  })
})

describe('quiz checks', () => {
  const opts = { types: 'both', count: 6 } as const

  it('accepts a good quiz', () => {
    expect(() => checkQuiz(goodQuiz(), opts)).not.toThrow()
  })

  it('rejects correct indices outside the options', () => {
    const q = goodQuiz()
    q.questions[1]!.correctOptions = [5]
    expect(() => checkQuiz(q, opts)).toThrow(/outside options/)
  })

  it('rejects multiselect questions without a correct option', () => {
    const q = goodQuiz()
    q.questions[1]!.correctOptions = []
    expect(() => checkQuiz(q, opts)).toThrow(/at least one correct/)
  })

  it('requires both types when asked for both', () => {
    const q = goodQuiz()
    q.questions = [q.questions[0]!, { ...q.questions[0]! }]
    expect(() => checkQuiz(q, opts)).toThrow(/mix of question types/)
  })

  it('enforces the requested type and count', () => {
    expect(() => checkQuiz(goodQuiz(), { types: 'open', count: 6 })).toThrow(/must be of type open/)
    expect(() => checkQuiz(goodQuiz(), { types: 'both', count: 1 })).toThrow(/at most 1/)
  })

  it('rejects an empty quiz', () => {
    expect(() => checkQuiz({ ...goodQuiz(), questions: [] }, opts)).toThrow(/No questions/)
  })

  it('builds the runner format with ids and cleaned answers', () => {
    const quiz = buildQuiz(goodQuiz())
    expect(quiz.source).toEqual({ type: 'facts' })
    expect(quiz.questions[0]).toMatchObject({ id: 'q1', type: 'open', acceptedAnswers: ['CO2'] })
    expect(quiz.questions[1]).toMatchObject({
      id: 'q2',
      type: 'multiselect',
      options: [
        { id: 'a', text: 'Oxygen' },
        { id: 'b', text: 'Glucose' },
        { id: 'c', text: 'Helium' },
      ],
      correct: ['a', 'b'],
    })
  })
})

describe('Quiz from Facts node', () => {
  const facts = '- Plants absorb carbon dioxide.\n- Photosynthesis releases oxygen.'

  function setup(answers: string[]) {
    const mock = mockLanguageModel(answers)
    return { ...mock, t: testContext({ model: mock.model }) }
  }

  it('turns facts into a quiz', async () => {
    const { t, prompts } = setup([JSON.stringify(goodQuiz())])
    const out = await run(
      quizFromFactsNode,
      t,
      { model: 'test:model', facts },
      { questionCount: 6, language: 'Polish' },
    )
    expect(out.quiz).toMatchObject({ title: 'Photosynthesis', source: { type: 'facts' } })
    const text = JSON.stringify(prompts[0])
    expect(text).toContain('Polish')
    expect(text).toContain('up to 6 questions')
    expect(text).toContain('Plants absorb carbon dioxide')
  })

  it('retries when the quiz fails the semantic checks, telling the model why', async () => {
    const bad = goodQuiz()
    bad.questions[1]!.correctOptions = [9]
    const { t, prompts, calls } = setup([JSON.stringify(bad), JSON.stringify(goodQuiz())])
    const out = await run(quizFromFactsNode, t, { model: 'test:model', facts })
    expect((out.quiz as { questions: unknown[] }).questions).toHaveLength(2)
    expect(calls()).toBe(2)
    expect(JSON.stringify(prompts[1])).toContain('outside options')
  })

  it('fails without calling the model when there are no facts', async () => {
    const { t, calls } = setup([JSON.stringify(goodQuiz())])
    await expect(run(quizFromFactsNode, t, { model: 'test:model', facts: '  ' })).rejects.toThrow(
      /No facts/,
    )
    expect(calls()).toBe(0)
  })
})

describe('Facts Extractor node', () => {
  async function setup(answers: string[]) {
    const mock = mockLanguageModel(answers)
    const t = testContext({ model: mock.model })
    const image = await t.assets.save(PNG, { name: 'page-12.png', mime: 'image/png' })
    return { ...mock, t, image }
  }

  it('lists the facts on the page as bullet lines', async () => {
    const { t, image, prompts } = await setup([
      JSON.stringify({
        readable: true,
        facts: [' Plants absorb CO2. ', '', 'Oxygen is released.'],
      }),
    ])
    const out = await run(
      factsExtractorNode,
      t,
      { model: 'test:model', image },
      { language: 'Polish' },
    )
    expect(out.facts).toBe('- Plants absorb CO2.\n- Oxygen is released.')
    expect(JSON.stringify(prompts[0])).toContain('Polish')
  })

  it('fails with a helpful message for an unreadable page', async () => {
    const { t, image } = await setup([JSON.stringify({ readable: false, facts: [] })])
    await expect(run(factsExtractorNode, t, { model: 'test:model', image })).rejects.toThrow(
      /could not read "page-12.png"/,
    )
  })
})

describe('model resolver', () => {
  const secrets = (keys: Record<string, string>) => ({ get: (p: string) => keys[p] })
  const services = (keys: Record<string, string> = {}, settings?: Record<string, string>) => ({
    assets: memoryAssets(),
    secrets: secrets(keys),
    settings: settings && { get: (k: string) => settings[k] },
  })

  it('names the env var when a provider has no key', () => {
    const models = createModelResolver(services())
    expect(() => models.language('anthropic:claude-sonnet-5-5')).toThrow(/ANTHROPIC_API_KEY/)
    expect(() => models.image('fal:fal-ai/flux/dev')).toThrow(/FAL_KEY/)
  })

  it('validates the model id format and provider', () => {
    const models = createModelResolver(services())
    expect(() => models.language('claude')).toThrow(/provider:model-name/)
    expect(() => models.language('mystery:x')).toThrow(/Unknown provider "mystery"/)
  })

  it('resolves configured providers and ollama without a key', () => {
    const models = createModelResolver(
      services({ anthropic: 'k', openai: 'k', fal: 'k', replicate: 'k' }),
    )
    expect(models.language('anthropic:claude-sonnet-5-5').modelId).toBe('claude-sonnet-5-5')
    expect(models.language('ollama:llama3.2').modelId).toBe('llama3.2')
    expect(models.image('openai:gpt-image-1').modelId).toBe('gpt-image-1')
    expect(models.speech('openai:gpt-4o-mini-tts').modelId).toBe('gpt-4o-mini-tts')
    expect(models.transcription('openai:gpt-4o-transcribe').modelId).toBe('gpt-4o-transcribe')
    expect(models.video('fal:luma-ray-2-flash').modelId).toBe('luma-ray-2-flash')
    expect(models.video('replicate:minimax/video-01').modelId).toBe('minimax/video-01')
  })

  it('normalizes the ollama URL', () => {
    expect(ollamaBaseUrl(undefined)).toBe('http://127.0.0.1:11434/api')
    expect(ollamaBaseUrl('http://box:11434/')).toBe('http://box:11434/api')
    expect(ollamaBaseUrl('http://box:11434/api')).toBe('http://box:11434/api')
  })

  it('normalizes the LM Studio URL', () => {
    expect(lmstudioBaseUrl(undefined)).toBe('http://localhost:1234/v1')
    expect(lmstudioBaseUrl('http://pc:1234/')).toBe('http://pc:1234/v1')
    expect(lmstudioBaseUrl('http://pc:1234/v1')).toBe('http://pc:1234/v1')
  })

  it('resolves lmstudio without a key', () => {
    expect(createModelResolver(services()).language('lmstudio:gemma-3-4b').modelId).toBe(
      'gemma-3-4b',
    )
  })
})
