export class IdFactory {
  private readonly alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  private token(length: number) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let value = ''
    for (let i = 0; i < length; i += 1) {
      value += this.alphabet[bytes[i]! % this.alphabet.length]
    }
    return value
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
    return `tab_${this.token(12)}`
  }

  audioId(): string {
    return this.token(6)
  }

  elementId(): string {
    return this.token(12)
  }
}
