/** Private identity sidecar: never serialized into XML or public model fields. */
export interface Identity {
  id?: string
  documentId?: string
  elementId?: string
  rowIds?: string[]
  columnIds?: string[]
  introBlocks?: import('./model.js').Block[]
}

const identities = new WeakMap<object, Identity>()

export function identity(value: object): Identity {
  return identities.get(value) ?? {}
}

export function withIdentity<T extends object>(value: T, ids: Identity): T {
  identities.set(value, ids)
  return value
}

export function copyIdentity<T extends object>(source: object, target: T): T {
  const ids = identities.get(source)
  if (ids) identities.set(target, ids)
  return target
}
