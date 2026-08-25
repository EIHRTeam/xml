import { isRecord } from './model.js'

export interface XmlPublicMeta {
  infoRoot?: Record<string, unknown>
  item?: Record<string, unknown>
  brief?: Record<string, unknown>
  documentExtraInfo?: Record<string, unknown>
}

export function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === 'function') {
    return structuredClone(value) as Record<string, unknown>
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export function omitKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  const omitted = new Set(keys)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!omitted.has(key)) {
      result[key] = entry
    }
  }
  return result
}

export function normalizeMetaRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? cloneRecord(value) : {}
}

export function hasMeta(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}
