export type {
  ConversionBatchEntry,
  ConversionBatchItem,
  ConversionBatchResult,
  ConversionResult,
  WikiJsonToXmlBatchEntry,
  WikiJsonToXmlBatchItem,
  WikiJsonToXmlBatchResult,
  XmlWikiFormat,
} from './types'
export type {
  AudioItem,
  AudioTab,
  Block,
  Chapter,
  ChapterGroup,
  ComplexTableBlock,
  ComplexTableCell,
  DocumentModel,
  EntryRefInline,
  ExternalVideoBlock,
  HorizontalLineBlock,
  ImageBlock,
  ImageIntro,
  Inline,
  LinkInline,
  ListBlock,
  ListItem,
  ParagraphBlock,
  PronunciationInline,
  QuoteBlock,
  SubType,
  Tab,
  TableRow,
  TextRunInline,
} from './model'
export { XmlWikiConversionError } from './model'
export {
  convert,
  submitJsonToWikiJson,
  submitJsonToXml,
  wikiJsonToSubmitJson,
  wikiJsonToXml,
  wikiJsonToXmlBatch,
  xmlToSubmitJson,
  xmlToWikiJson,
  xmlToWikiJsonBatch,
  type ConvertOptions,
} from './convert'
export {
  documentFromJsonText as parseWikiJsonWithWarnings,
  documentToJsonText as renderWikiJson,
  documentToWikiJsonObject,
  parseSubmitJson,
  renderSubmitJson,
  type RenderWikiJsonOptions,
} from './jsonFormat'
export { documentFromXmlText as parseXmlWithWarnings, documentToXmlText as renderXml } from './xmlFormat'

export { parseWikiJson, parseXml }

import { documentFromJsonText } from './jsonFormat'
import { documentFromXmlText } from './xmlFormat'

function parseWikiJson(source: string | object) {
  return documentFromJsonText(source)[0]
}

function parseXml(source: string) {
  return documentFromXmlText(source)[0]
}
