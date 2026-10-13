import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import { defineNode } from '@anygen/core'

const MEMORY_LIMIT = 64 * 1024 * 1024
const STACK_LIMIT = 1024 * 1024

/**
 * Runs `code` as a function body inside a QuickJS (WASM) VM: no `process`, `require`, `fetch`,
 * file or network access, with memory and time limits. Values cross the boundary as JSON.
 * Execution is synchronous and blocks the server's event loop until it finishes or times out.
 */
export async function runSandboxed(opts: {
  code: string
  inputs: unknown
  timeoutMs: number
  signal?: AbortSignal
}): Promise<unknown> {
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT)
  runtime.setMaxStackSize(STACK_LIMIT)
  const pastDeadline = shouldInterruptAfterDeadline(Date.now() + opts.timeoutMs)
  runtime.setInterruptHandler((rt) => pastDeadline(rt) || opts.signal?.aborted === true)
  const vm = runtime.newContext()

  // JSON.stringify(JSON.stringify(x)) yields a string literal that is safe to embed in source.
  const lit = (v: unknown) => JSON.stringify(JSON.stringify(v ?? null))
  const source = `(function () {
  const inputs = JSON.parse(${lit(opts.inputs)});
  const result = (function (inputs) {
${opts.code}
  })(inputs);
  return result === undefined ? "null" : JSON.stringify(result);
})()`

  try {
    const res = vm.evalCode(source, 'custom-code.js')
    if (res.error) {
      const err = vm.dump(res.error) as { name?: string; message?: string } | string
      res.error.dispose()
      if (opts.signal?.aborted) throw new Error('Cancelled')
      const message = typeof err === 'string' ? err : `${err.name ?? 'Error'}: ${err.message ?? ''}`
      throw new Error(
        /interrupted/i.test(message) ? `Code timed out after ${opts.timeoutMs} ms` : message,
      )
    }
    const json = vm.getString(res.value)
    res.value.dispose()
    return JSON.parse(json)
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}

export const customCodeNode = defineNode({
  id: 'generic/code',
  title: 'Custom Code',
  category: 'Generic',
  description:
    'JavaScript function body with `inputs` (with a and b); `return` the result. Runs in an isolated sandbox: no network, files or Node APIs, and values must be JSON.',
  inputs: [
    { name: 'a', type: 'any', required: false },
    { name: 'b', type: 'any', required: false },
  ],
  outputs: [{ name: 'result', type: 'any' }],
  params: [
    { name: 'code', type: 'textarea', label: 'Code', default: 'return inputs.a;' },
    {
      name: 'timeoutMs',
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      min: 100,
      max: 30000,
      step: 100,
    },
  ],
  execute: async (ctx, inputs, params) => {
    const timeoutMs = Math.min(30000, Math.max(100, Number(params.timeoutMs ?? 5000)))
    return {
      result: await runSandboxed({
        code: String(params.code ?? ''),
        inputs,
        timeoutMs,
        signal: ctx.signal,
      }),
    }
  },
})
