import type { DocumentModel } from './model.js'
import {
  documentFromJsonText,
  documentToJsonText,
  parseSubmitJson,
  renderSubmitJson,
  type RenderWikiJsonOptions,
} from './jsonFormat.js'
import { documentFromXmlText, documentToXmlText } from './xmlFormat.js'
import type {
  ConversionBatchEntry,
  ConversionBatchResult,
  ConversionResult,
  WikiJsonToXmlBatchEntry,
  WikiJsonToXmlBatchResult,
  XmlWikiFormat,
} from './types.js'

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

export function xmlToWikiJsonBatch<TMeta = unknown>(
  entries: ConversionBatchEntry<TMeta>[],
  options: RenderWikiJsonOptions = {},
): ConversionBatchResult<TMeta> {
  const items = entries.map((entry, index) => {
    try {
      const result = xmlToWikiJson(entry.source, options)
      return {
        text: result.text,
        warnings: result.warnings,
        ...('meta' in entry ? { meta: entry.meta } : {}),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`xmlToWikiJsonBatch entry ${index} failed: ${message}`)
    }
  })

  return {
    items,
    warnings: items.flatMap((item, index) =>
      item.warnings.map((warning) => `entry ${index}: ${warning}`),
    ),
  }
}

export function submitJsonToXml(json: string | object): ConversionResult {
  const [document, warnings] = parseSubmitJson(json)
  return { text: documentToXmlText(document), warnings }
}

export function xmlToSubmitJson(xml: string): ConversionResult {
  const [document, warnings] = documentFromXmlText(xml)
  return { text: renderSubmitJson(document), warnings }
}

export function wikiJsonToSubmitJson(json: string | object): ConversionResult {
  const [document, warnings] = documentFromJsonText(json)
  return { text: renderSubmitJson(document), warnings }
}

export function submitJsonToWikiJson(json: string | object): ConversionResult {
  const [document, warnings] = parseSubmitJson(json)
  return { text: documentToJsonText(document), warnings }
}
