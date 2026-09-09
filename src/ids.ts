import { identity, withIdentity } from './identity.js'
import { XmlWikiConversionError } from './model.js'

export class IdFactory {
  private readonly alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  private readonly reserved: Set<string>
  private readonly preserve: boolean

  private state: number[] | undefined

  constructor(reserved: Set<string> = new Set(), preserve = false, seed?: string) {
    if (seed !== undefined) {
      // Four independently mixed words seed a reproducible, non-security ID stream.
      this.state = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0xdeadbeef].map((initial) => {
        let hash = initial
        for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
        return hash >>> 0
      })
    }
    this.reserved = reserved
    this.preserve = preserve
  }

  get preservesIds(): boolean {
    return this.preserve
  }

  private readonly claimed = new Map<object | string, Set<string>>()
  private documentScope: object = {}

  beginDocument(blocks: object): void {
    this.documentScope = blocks
  }

  reuse(
    value: object,
    key: 'id' | 'documentId' | 'elementId',
    create: () => string,
    scope: object | string = this.documentScope,
  ): string {
    const candidate = this.preserve ? identity(value)[key] : undefined
    if (!candidate) return create()
    const used = this.claimed.get(scope) ?? new Set<string>()
    if (used.has(candidate)) return create()
    used.add(candidate)
    this.claimed.set(scope, used)
    return candidate
  }

  tableId(value: object, key: 'rowIds' | 'columnIds', index: number): string {
    const ids = this.preserve ? identity(value)[key] : undefined
    const id = ids?.[index]
    return this.reuse(withIdentity({}, id ? { id } : {}), 'id', () => this.itemId(), ids ?? value)
  }

  fixedBlockId(id: string): string {
    const used = this.claimed.get(this.documentScope) ?? new Set<string>()
    if (used.has(id)) throw new XmlWikiConversionError(`Duplicate fixed video block ID '${id}'.`)
    used.add(id)
    this.claimed.set(this.documentScope, used)
    return id
  }

  private token(length: number, prefix = ''): string {
    const bytes = new Uint8Array(length)
    for (;;) {
      if (this.state) {
        for (let i = 0; i < length; i++) {
          let [a, b, c, d] = this.state as [number, number, number, number]
          const value = ((a + b | 0) + d | 0)
          d = d + 1 | 0
          a = b ^ b >>> 9
          b = c + (c << 3) | 0
          c = (c << 21 | c >>> 11) + value | 0
          this.state = [a, b, c, d]
          bytes[i] = value >>> 24
        }
      } else {
        crypto.getRandomValues(bytes)
      }
      let value = prefix
      for (let i = 0; i < length; i += 1) {
        value += this.alphabet[bytes[i]! % this.alphabet.length]
      }
      if (this.reserved.has(value)) continue
      this.reserved.add(value)
      return value
    }
  }

  widgetId(): string {
    return this.token(8)
  }

  blockId(): string {
    return this.token(12)
  }

  itemId(): string {
    return this.token(12)
  }

  tabId(): string {
    return this.token(12, 'tab_')
  }

  audioId(): string {
    return this.token(6)
  }

  elementId(): string {
    return this.token(12)
  }
}
