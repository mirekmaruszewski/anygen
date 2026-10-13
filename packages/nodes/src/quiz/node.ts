import { defineNode } from '@anygen/core'
import { runStructured } from '../ai/text'
import { modelParam } from '../llm/chat'
import {
  buildQuiz,
  checkQuiz,
  modelQuizSchema,
  quizPrompt,
  type ModelQuiz,
  type QuestionTypes,
} from './quiz'

export const quizFromFactsNode = defineNode({
  id: 'quiz/from-facts',
  title: 'Quiz from Facts',
  category: 'Quiz',
  description:
    'Turns a text of facts into open, single (one correct option) and multiselect questions with answers. The result is checked (correct options exist, both types present) and retried once if not.',
  inputs: [{ name: 'facts', type: 'text' }],
  outputs: [{ name: 'quiz', type: 'json' }],
  params: [
    modelParam('anthropic:claude-sonnet-5-5'),
    {
      name: 'questionCount',
      type: 'number',
      label: 'Questions',
      default: 6,
      min: 1,
      max: 30,
      step: 1,
    },
    { name: 'language', type: 'text', label: 'Language', default: '' },
    {
      name: 'difficulty',
      type: 'select',
      label: 'Difficulty',
      default: 'medium',
      options: ['easy', 'medium', 'hard'],
    },
    {
      name: 'questionTypes',
      type: 'select',
      label: 'Question types',
      default: 'both',
      options: [
        { value: 'both', label: 'Open + multiselect' },
        { value: 'all', label: 'Open + single + multiselect' },
        { value: 'open', label: 'Open only' },
        { value: 'single', label: 'Single only (one answer)' },
        { value: 'multiselect', label: 'Multiselect only' },
      ],
    },
    { name: 'title', type: 'text', label: 'Title (optional)', default: '' },
    { name: 'instructions', type: 'textarea', label: 'Extra instructions', default: '' },
  ],
  execute: async (ctx, inputs, params) => {
    const facts = String(inputs.facts ?? '').trim()
    if (!facts) throw new Error('No facts to write questions from')
    const count = Math.min(30, Math.max(1, Math.trunc(Number(params.questionCount ?? 6))))
    const types = (params.questionTypes ?? 'both') as QuestionTypes

    const model = await runStructured<ModelQuiz>({
      ctx,
      model: String(params.model),
      temperature: 0.4,
      schema: modelQuizSchema,
      validate: (out) => checkQuiz(out as ModelQuiz, { types, count }),
      messages: [
        {
          role: 'user',
          content: quizPrompt({
            facts,
            count,
            types,
            language: String(params.language ?? ''),
            difficulty: String(params.difficulty ?? 'medium'),
            title: String(params.title ?? ''),
            extra: String(params.instructions ?? ''),
          }),
        },
      ],
    })
    return { quiz: buildQuiz(model) }
  },
})
