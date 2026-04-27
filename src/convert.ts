import type { DocumentModel } from './model'
import { documentFromJsonText, documentToJsonText, type RenderWikiJsonOptions } from './jsonFormat'
import { documentFromXmlText, documentToXmlText } from './xmlFormat'
import type {
  ConversionResult,
  WikiJsonToXmlBatchEntry,
  WikiJsonToXmlBatchResult,
  XmlWikiFormat,
} from './types'

export interface ConvertOptions extends RenderWikiJsonOptions {
  from: XmlWikiFormat
  to: XmlWikiFormat
}

export function convert(source: string | object, options: ConvertOptions): ConversionResult {
  const { from, to, ...renderOptions } = options
  if (from === to) {
    return {
      text: typeof source === 'string' ? source : `${JSON.stringify(source, null, 4)}\n`,
      warnings: [],
    }
  }

  let document: DocumentModel
  let warnings: string[]

  if (from === 'wiki-json') {
    ;[document, warnings] = documentFromJsonText(source)
  } else if (from === 'xml') {
    if (typeof source !== 'string') {
      throw new TypeError('XML input must be a string.')
    }
    ;[document, warnings] = documentFromXmlText(source)
  } else {
    throw new TypeError(`Unsupported input format: ${String(from)}`)
  }

  if (to === 'wiki-json') {
    return {
      text: documentToJsonText(document, renderOptions),
      warnings,
    }
  }

  if (to === 'xml') {
    return {
      text: documentToXmlText(document),
      warnings,
    }
  }

  throw new TypeError(`Unsupported output format: ${String(to)}`)
}

export function wikiJsonToXml(json: string | object): ConversionResult {
  return convert(json, { from: 'wiki-json', to: 'xml' })
}

export function wikiJsonToXmlBatch<TMeta = unknown>(
  entries: WikiJsonToXmlBatchEntry<TMeta>[]
): WikiJsonToXmlBatchResult<TMeta> {
  const items = entries.map((entry, index) => {
    try {
      const result = wikiJsonToXml(entry.source)
      return {
        text: result.text,
        warnings: result.warnings,
        ...('meta' in entry ? { meta: entry.meta } : {}),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`wikiJsonToXmlBatch entry ${index} failed: ${message}`)
    }
  })

  return {
    items,
    warnings: items.flatMap((item, index) =>
      item.warnings.map((warning) => `entry ${index}: ${warning}`)
    ),
  }
}

export function xmlToWikiJson(xml: string, options: RenderWikiJsonOptions = {}): ConversionResult {
  return convert(xml, { from: 'xml', to: 'wiki-json', ...options })
}
