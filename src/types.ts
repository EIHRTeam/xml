export type XmlWikiFormat = 'wiki-json' | 'xml'

export interface ConversionResult {
  text: string
  warnings: string[]
}

export interface WikiJsonToXmlBatchEntry<TMeta = unknown> {
  source: string | object
  meta?: TMeta
}

export interface WikiJsonToXmlBatchItem<TMeta = unknown> extends ConversionResult {
  meta?: TMeta
}

export interface WikiJsonToXmlBatchResult<TMeta = unknown> {
  items: WikiJsonToXmlBatchItem<TMeta>[]
  warnings: string[]
}
