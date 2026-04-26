export class IdFactory {
  private readonly alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  private token(length: number) {
    let value = ''
    for (let i = 0; i < length; i += 1) {
      value += this.alphabet[Math.floor(Math.random() * this.alphabet.length)]
    }
    return value
  }

  widgetId() {
    return this.token(8)
  }

  blockId() {
    return this.token(12)
  }

  itemId() {
    return this.token(12)
  }

  tabId() {
    return `tab_${this.token(12)}`
  }

  audioId() {
    return this.token(6)
  }
}
