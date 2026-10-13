import { defineNode } from '@anygen/core'

/** Replaces `{{name}}` (whitespace allowed) with the matching variable; unknown names become empty. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g, (_m, path: string) => {
    let value: unknown = vars
    for (const key of path.split('.')) {
      value = (value as Record<string, unknown> | null | undefined)?.[key]
    }
    if (value === undefined || value === null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

export const templateNode = defineNode({
  id: 'core/template',
  title: 'Prompt Template',
  category: 'Utility',
  description:
    'Fills {{variables}} in a template. Variables a to d come from the text inputs; "vars" (a JSON object) adds more, and dotted names like {{user.name}} reach into it.',
  inputs: [
    { name: 'a', type: 'text', required: false },
    { name: 'b', type: 'text', required: false },
    { name: 'c', type: 'text', required: false },
    { name: 'd', type: 'text', required: false },
    { name: 'vars', type: 'json', required: false },
  ],
  outputs: [{ name: 'text', type: 'text' }],
  params: [{ name: 'template', type: 'textarea', label: 'Template', default: 'Summarize: {{a}}' }],
  execute: (_ctx, inputs, params) => {
    const extra =
      inputs.vars && typeof inputs.vars === 'object' && !Array.isArray(inputs.vars)
        ? (inputs.vars as Record<string, unknown>)
        : {}
    const vars = { ...extra, a: inputs.a, b: inputs.b, c: inputs.c, d: inputs.d }
    return { text: renderTemplate(String(params.template ?? ''), vars) }
  },
})
