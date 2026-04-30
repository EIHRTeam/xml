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

export interface ConversionBatchEntry<TMeta = unknown> {
  source: string
  meta?: TMeta
}

export interface ConversionBatchItem<TMeta = unknown> extends ConversionResult {
  meta?: TMeta
}

export interface ConversionBatchResult<TMeta = unknown> {
  items: ConversionBatchItem<TMeta>[]
  warnings: string[]
}
