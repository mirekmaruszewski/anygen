import { z } from 'zod'
import { PortTypeSchema } from './ports'

const IdentifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Must be an identifier (letters, digits, underscore)')

export const PortDefSchema = z.object({
  name: IdentifierSchema,
  type: PortTypeSchema,
  label: z.string().optional(),
  description: z.string().optional(),
  /** Inputs only: when false (or when a `default` exists) the port may stay unconnected. */
  required: z.boolean().default(true),
  /** Inputs only: value used when the port is unconnected. */
  default: z.unknown().optional(),
})
export type PortDef = z.infer<typeof PortDefSchema>

export const PARAM_TYPES = [
  'text',
  'textarea',
  'number',
  'slider',
  'boolean',
  'select',
  'json',
  /** A file picked/uploaded in the editor; the value is an `AssetRef` (or null). */
  'asset',
] as const

const ParamOptionSchema = z.union([
  z.string(),
  z.object({ value: z.string(), label: z.string().optional() }),
])

export const ParamDefSchema = z
  .object({
    name: IdentifierSchema,
    type: z.enum(PARAM_TYPES),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    options: z.array(ParamOptionSchema).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    /** `asset` params: accepted MIME pattern for the file picker, e.g. `image/*`. */
    accept: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.type === 'select' && !p.options?.length) {
      ctx.addIssue({ code: 'custom', message: 'select params need at least one option' })
    }
  })
export type ParamDef = z.infer<typeof ParamDefSchema>

function uniqueNames(items: { name: string }[], ctx: z.RefinementCtx, what: string) {
  const seen = new Set<string>()
  for (const { name } of items) {
    if (seen.has(name)) ctx.addIssue({ code: 'custom', message: `Duplicate ${what} "${name}"` })
    seen.add(name)
  }
}

/** The serializable (non-function) part of a node definition. This is what the catalog serves. */
export const NodeMetaSchema = z
  .object({
    /** Unique node type id, referenced by `GraphNode.type`, e.g. `core/text`. */
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.string().min(1),
    description: z.string().optional(),
    /** Bump when behaviour changes so stale cache entries are not reused. */
    version: z.number().int().default(1),
    inputs: z.array(PortDefSchema).default([]),
    outputs: z.array(PortDefSchema).default([]),
    params: z.array(ParamDefSchema).default([]),
    /** Set false for non-deterministic or side-effecting nodes (never cached). */
    cache: z.boolean().default(true),
  })
  .superRefine((n, ctx) => {
    uniqueNames(n.inputs, ctx, 'input')
    uniqueNames(n.outputs, ctx, 'output')
    uniqueNames(n.params, ctx, 'param')
  })
export type NodeMeta = z.infer<typeof NodeMetaSchema>
export type NodeMetaInput = z.input<typeof NodeMetaSchema>

export type PortValues = Record<string, unknown>

export interface NodeProgress {
  /** 0..1 when known. */
  fraction?: number
  message?: string
  /** Partial output so far (e.g. streamed LLM text). */
  partial?: unknown
}

export interface ExecutionContext {
  runId: string
  nodeId: string
  /** Aborted when the run is cancelled; long-running nodes should honour it. */
  signal: AbortSignal
  progress(update: NodeProgress): void
  /** Host-provided services (asset store, secrets, …), injected via executor run options. */
  services: Record<string, unknown>
}

export interface NodeDefinition extends NodeMeta {
  execute(
    ctx: ExecutionContext,
    inputs: PortValues,
    params: PortValues,
  ): Promise<PortValues> | PortValues
}

export type NodeDefinitionInput = NodeMetaInput & { execute: NodeDefinition['execute'] }

/** Validates and normalizes (applies defaults to) a node definition. */
export function defineNode(input: NodeDefinitionInput): NodeDefinition {
  const { execute, ...meta } = input
  if (typeof execute !== 'function') {
    throw new TypeError(`Node "${meta.id}" needs an execute function`)
  }
  return { ...NodeMetaSchema.parse(meta), execute }
}

/** Strips `execute`, yielding the JSON-safe catalog entry. */
export function toCatalogEntry(def: NodeDefinition): NodeMeta {
  const { execute, ...meta } = def
  void execute
  return meta
}
