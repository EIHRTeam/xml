import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom'

export const ELEMENT_NODE = 1
export const TEXT_NODE = 3
export const CDATA_SECTION_NODE = 4

type ParserCtor = new () => DOMParser

function getNativeDOMParser(): ParserCtor | null {
  const parser = (globalThis as { DOMParser?: ParserCtor }).DOMParser
  return typeof parser === 'function' ? parser : null
}

export function parseXmlDocument(source: string): Document {
  const NativeDOMParser = getNativeDOMParser()
  if (NativeDOMParser) {
    return new NativeDOMParser().parseFromString(source, 'application/xml')
  }

  const errors: string[] = []
  const parser = new XmldomDOMParser({
    errorHandler(level: 'warning' | 'error' | 'fatalError', message: string) {
      if (level !== 'warning') {
        errors.push(message)
      }
    },
  })
  const document = parser.parseFromString(source, 'application/xml') as unknown as Document
  if (errors.length) {
    const error = document.createElement('parsererror')
    error.appendChild(document.createTextNode(errors[0]!))
    document.documentElement?.appendChild(error)
  }
  return document
}
