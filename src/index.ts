export type {
  ConversionBatchEntry,
  ConversionBatchItem,
  ConversionBatchResult,
  ConversionResult,
  WikiJsonToXmlBatchEntry,
  WikiJsonToXmlBatchItem,
  WikiJsonToXmlBatchResult,
  XmlWikiFormat,
} from './types.js'
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
} from './model.js'
export { XmlWikiConversionError } from './model.js'
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
} from './convert.js'
export {
  documentFromJsonText as parseWikiJsonWithWarnings,
  documentToJsonText as renderWikiJson,
  documentToWikiJsonObject,
  parseSubmitJson,
  renderSubmitJson,
  type RenderWikiJsonOptions,
} from './jsonFormat.js'
export {
  documentFromXmlText as parseXmlWithWarnings,
  documentToXmlText as renderXml,
} from './xmlFormat.js'

export { parseWikiJson, parseXml }

import type { DocumentModel } from './model.js'
import { documentFromJsonText } from './jsonFormat.js'
import { documentFromXmlText } from './xmlFormat.js'

function parseWikiJson(source: string | object): DocumentModel {
  return documentFromJsonText(source)[0]
}

function parseXml(source: string): DocumentModel {
  return documentFromXmlText(source)[0]
}
