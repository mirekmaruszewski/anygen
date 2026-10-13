import { z } from 'zod'

export const BASE_PORT_TYPES = [
  'text',
  'number',
  'boolean',
  'image',
  'audio',
  'video',
  'json',
  'any',
] as const

export type BasePortType = (typeof BASE_PORT_TYPES)[number]
export type PortType = BasePortType | `list<${string}>`

const LIST_RE = /^list<(.+)>$/

/** Returns true for `text`, `image`, … and (nested) `list<T>` of valid types. */
export function isPortType(value: string): value is PortType {
  if ((BASE_PORT_TYPES as readonly string[]).includes(value)) return true
  const inner = LIST_RE.exec(value)?.[1]
  return inner !== undefined && isPortType(inner)
}

export const PortTypeSchema = z.string().refine(isPortType, {
  message: `Invalid port type (expected one of ${BASE_PORT_TYPES.join(', ')} or list<T>)`,
}) as unknown as z.ZodType<PortType>

/**
 * Whether an output of type `from` may feed an input of type `to`.
 * `any` is compatible with everything; lists are compatible when their item types are.
 * Anything else needs an explicit converter node.
 */
export function isPortCompatible(from: PortType, to: PortType): boolean {
  if (from === 'any' || to === 'any') return true
  if (from === to) return true
  const fromItem = LIST_RE.exec(from)?.[1]
  const toItem = LIST_RE.exec(to)?.[1]
  if (fromItem && toItem) return isPortCompatible(fromItem as PortType, toItem as PortType)
  return false
}
