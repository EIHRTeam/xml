export type XmlWikiFormat = 'wiki-json' | 'xml'

export interface ConversionResult {
  text: string
  warnings: string[]
}
