import { z } from 'zod'

/**
 * What the model is asked to produce. Deliberately flat (no unions) so every provider's structured
 * output mode handles it; options are plain strings and correct answers are indices.
 */
export const modelQuizSchema = z.object({
  title: z.string().describe('Short title for the quiz'),
  language: z.string().describe('Language code of the questions, e.g. "en" or "pl"'),
  questions: z.array(
    z.object({
      type: z.enum(['open', 'single', 'multiselect']),
      question: z.string(),
      answer: z.string().describe('open: the model answer. single/multiselect: empty string'),
      acceptedAnswers: z
        .array(z.string())
        .describe('open: other acceptable phrasings. single/multiselect: empty array'),
      options: z
        .array(z.string())
        .describe('single/multiselect: 3 to 6 options. open: empty array'),
      correctOptions: z
        .array(z.number().int())
        .describe(
          'single: exactly one index. multiselect: indices of every correct option. open: empty',
        ),
      explanation: z.string().describe('Why the answer is right, one or two sentences'),
    }),
  ),
})
export type ModelQuiz = z.infer<typeof modelQuizSchema>

/**
 * The quiz runner's format. PLACEHOLDER: the real format is not known yet (see docs/PLAN.md), so
 * adapting to it means changing only `buildQuiz` below.
 */
export interface Quiz {
  title: string
  source: { type: 'facts' }
  language: string
  questions: QuizQuestion[]
}

export type QuizQuestion =
  | {
      id: string
      type: 'open'
      question: string
      answer: string
      acceptedAnswers: string[]
      explanation?: string
    }
  | {
      id: string
      type: 'single'
      question: string
      options: { id: string; text: string }[]
      correct: string
      explanation?: string
    }
  | {
      id: string
      type: 'multiselect'
      question: string
      options: { id: string; text: string }[]
      correct: string[]
      explanation?: string
    }

export type QuestionTypes = 'both' | 'all' | 'open' | 'single' | 'multiselect'

/** Question types each setting allows ('both' is open + multiselect, kept for existing workflows). */
const allowedTypes: Record<QuestionTypes, ModelQuiz['questions'][number]['type'][]> = {
  both: ['open', 'multiselect'],
  all: ['open', 'single', 'multiselect'],
  open: ['open'],
  single: ['single'],
  multiselect: ['multiselect'],
}

const optionId = (i: number) => String.fromCharCode(97 + i) // a, b, c, …

/** Semantic checks the schema cannot express. Throws a message the model can act on. */
export function checkQuiz(quiz: ModelQuiz, opts: { types: QuestionTypes; count: number }): void {
  if (!quiz.questions.length) throw new Error('No questions were produced')
  if (quiz.questions.length > opts.count) {
    throw new Error(`Expected at most ${opts.count} questions, got ${quiz.questions.length}`)
  }

  quiz.questions.forEach((q, i) => {
    const n = i + 1
    if (!q.question.trim()) throw new Error(`Question ${n} is empty`)
    if (!allowedTypes[opts.types].includes(q.type)) {
      throw new Error(`Question ${n} must be of type ${allowedTypes[opts.types].join(' or ')}`)
    }
    if (q.type === 'open') {
      if (!q.answer.trim()) throw new Error(`Open question ${n} has no answer`)
      return
    }
    if (q.options.length < 2) throw new Error(`Question ${n} needs at least 2 options`)
    if (q.options.some((o) => !o.trim())) throw new Error(`Question ${n} has an empty option`)
    if (new Set(q.options).size !== q.options.length) {
      throw new Error(`Question ${n} has duplicate options`)
    }
    if (!q.correctOptions.length) {
      throw new Error(`Question ${n} needs at least one correct option`)
    }
    if (q.type === 'single' && q.correctOptions.length !== 1) {
      throw new Error(`Single question ${n} needs exactly one correct option`)
    }
    for (const c of q.correctOptions) {
      if (c < 0 || c >= q.options.length) {
        throw new Error(
          `Question ${n}: correct option index ${c} is outside options (0..${q.options.length - 1})`,
        )
      }
    }
    if (new Set(q.correctOptions).size !== q.correctOptions.length) {
      throw new Error(`Question ${n} lists the same correct option twice`)
    }
  })

  if ((opts.types === 'both' || opts.types === 'all') && opts.count >= 2) {
    const kinds = new Set(quiz.questions.map((q) => q.type))
    if (kinds.size < 2) throw new Error('Include a mix of question types')
  }
}

/** Converts the (already checked) model output into the quiz runner's format. */
export function buildQuiz(model: ModelQuiz): Quiz {
  return {
    title: model.title.trim(),
    source: { type: 'facts' },
    language: model.language.trim(),
    questions: model.questions.map((q, i): QuizQuestion => {
      const id = `q${i + 1}`
      const explanation = q.explanation.trim() || undefined
      if (q.type === 'open') {
        const accepted = [...new Set(q.acceptedAnswers.map((a) => a.trim()).filter(Boolean))]
        return {
          id,
          type: 'open',
          question: q.question.trim(),
          answer: q.answer.trim(),
          acceptedAnswers: accepted,
          explanation,
        }
      }
      if (q.type === 'single') {
        return {
          id,
          type: 'single',
          question: q.question.trim(),
          options: q.options.map((text, j) => ({ id: optionId(j), text: text.trim() })),
          correct: optionId(q.correctOptions[0]!),
          explanation,
        }
      }
      return {
        id,
        type: 'multiselect',
        question: q.question.trim(),
        options: q.options.map((text, j) => ({ id: optionId(j), text: text.trim() })),
        correct: q.correctOptions.map(optionId),
        explanation,
      }
    }),
  }
}

export function quizPrompt(opts: {
  facts: string
  count: number
  language: string
  difficulty: string
  types: QuestionTypes
  title: string
  extra: string
}): string {
  const kinds =
    opts.types === 'both'
      ? 'a mix of open questions and multiselect questions (one or more correct options out of 3 to 6)'
      : opts.types === 'all'
        ? 'a mix of open questions, single questions (exactly one correct option out of 3 to 6) and multiselect questions (one or more correct options out of 3 to 6)'
        : opts.types === 'open'
          ? 'open questions only'
          : opts.types === 'single'
            ? 'single questions only (exactly one correct option out of 3 to 6)'
            : 'multiselect questions only (one or more correct options out of 3 to 6)'
  return [
    'Below are facts. Write a quiz that tests understanding of them.',
    `Write up to ${opts.count} questions: ${kinds}.`,
    `Difficulty: ${opts.difficulty}.`,
    `Language: ${opts.language.trim() || 'the language of the facts'}.`,
    opts.title.trim() ? `Use the title "${opts.title.trim()}".` : 'Choose a short fitting title.',
    'Only ask about the facts given. Make wrong options plausible. Do not give away answers in the question text.',
    opts.extra.trim() ? `Additional instructions: ${opts.extra.trim()}` : '',
  ]
    .filter(Boolean)
    .concat('', 'Facts:', opts.facts.trim())
    .join('\n')
}
