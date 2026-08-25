import { DEFAULT_JSON_TEXT_COLOR, JSON_TO_XML_COLOR, XML_TO_JSON_COLOR } from './colors'
import { JSON_ENTRY_TO_XML, SCALE_COLOR_SET, VIDEO_KINDS, XML_ENTRY_TO_JSON } from './constants'
import { IdFactory } from './ids'
import { cloneRecord, normalizeMetaRecord, omitKeys } from './publicMeta'
import {
  AudioItem,
  AudioTab,
  Block,
  Chapter,
  ChapterGroup,
  ComplexTableBlock,
  ComplexTableCell,
  DocumentModel,
  EndfieldWikitextConversionError,
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
  blocksToInlines,
  blocksToPlainText,
  isComplexTable,
  isExternalVideo,
  isImage,
  isList,
  isParagraph,
  isQuote,
  isRecord,
  isTextRun,
  normalizeBlocks,
  paragraph,
  textRun,
  validateComplexTableBlock,
} from './model'

export interface RenderWikiJsonOptions {
  wrapInfoRoot?: boolean
  envelope?: Record<string, unknown>
}

type JsonRenderTarget = 'wiki' | 'submit'

function ensureMapping(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new EndfieldWikitextConversionError(`Expected object at '${location}'.`)
  }
  return value
}

function requireMapping(payload: Record<string, unknown>, location: string, key: string) {
  return ensureMapping(payload[key], `${location}.${key}`)
}

function requireList(payload: Record<string, unknown>, location: string, key: string) {
  const value = payload[key]
  if (!Array.isArray(value)) {
    throw new EndfieldWikitextConversionError(`Expected list at '${location}'.`)
  }
  return value
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? null : String(value)
}

function audioItemsFromList(raw: unknown[], location: string): AudioItem[] {
  return raw.map((entry, index) => {
    const entryLocation = `${location}[${index}]`
    const entryMap = ensureMapping(entry, entryLocation)
    return {
      title: requireString(entryMap, `${entryLocation}.title`, 'title'),
      profile: requireString(entryMap, `${entryLocation}.profile`, 'profile'),
      resourceUrl: requireString(entryMap, `${entryLocation}.resourceUrl`, 'resourceUrl'),
    }
  })
}

function requireString(
  payload: Record<string, unknown>,
  location: string,
  key: string,
  defaultValue?: string
) {
  const value = payload[key] ?? defaultValue
  if (typeof value !== 'string') {
    throw new EndfieldWikitextConversionError(`Expected string at '${location}'.`)
  }
  return value
}

function requireNumber(payload: Record<string, unknown>, location: string, key: string) {
  const value = payload[key]
  if (typeof value !== 'number') {
    throw new EndfieldWikitextConversionError(`Expected number at '${location}'.`)
  }
  return value
}

function optionalDocumentBlocks(value: unknown, location: string) {
  if (value == null) {
    return {
      blocks: [] as Block[],
      wasNull: true,
    }
  }

  return {
    blocks: blocksFromDocument(ensureMapping(value, location)),
    wasNull: false,
  }
}

function ensureStringList(values: unknown[], location: string) {
  if (!values.every((value) => typeof value === 'string')) {
    throw new EndfieldWikitextConversionError(`Expected string list at '${location}'.`)
  }
  return values as string[]
}

function parseIntValue(value: unknown, location: string) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed)) {
    throw new EndfieldWikitextConversionError(`Expected integer at '${location}'.`)
  }
  if (parsed < 1) {
    throw new EndfieldWikitextConversionError(`Expected positive integer at '${location}'.`)
  }
  return parsed
}

function splitTableCellKey(cellKey: string): [string, string] {
  const separatorIndex = cellKey.indexOf('_')
  if (separatorIndex < 0) {
    throw new EndfieldWikitextConversionError(`Invalid table cell id '${cellKey}'.`)
  }
  return [cellKey.slice(0, separatorIndex), cellKey.slice(separatorIndex + 1)]
}

function headerModeFromJson(rowHeader: boolean, colHeader: boolean) {
  if (rowHeader && colHeader) {
    return 'both'
  }
  if (rowHeader) {
    return 'row'
  }
  if (colHeader) {
    return 'col'
  }
  return 'none'
}

function parseJsonInput(source: string | object): unknown {
  if (typeof source !== 'string') {
    return source
  }

  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EndfieldWikitextConversionError(`Invalid JSON: ${message}`)
  }
}

function extractInfoItem(parsed: unknown) {
  const payload = ensureMapping(parsed, 'root')

  if (isRecord(payload.data) && isRecord(payload.data.item)) {
    return {
      item: payload.data.item,
      infoRootMeta: omitKeys(payload, ['data']),
    }
  }

  if (isRecord(payload.brief) && isRecord(payload.document)) {
    return {
      item: payload,
      infoRootMeta: {},
    }
  }

  throw new EndfieldWikitextConversionError(
    'Wiki JSON must be an InfoItem object or an InfoRoot object containing `data.item`.'
  )
}

function buildDocumentFromItem(
  item: Record<string, unknown>,
  infoRootMeta: Record<string, unknown>,
  commitMsg: string | undefined,
): DocumentModel {
  const brief = requireMapping(item, 'item.brief', 'brief')
  const content = requireMapping(item, 'item.document', 'document')
  const chapterGroupsData = requireList(content, 'item.document.chapterGroup', 'chapterGroup')
  const widgetCommonMap = requireMapping(content, 'item.document.widgetCommonMap', 'widgetCommonMap')
  const documentMap = requireMapping(content, 'item.document.documentMap', 'documentMap')

  const description = optionalDocumentBlocks(brief.description, 'item.brief.description')

  const chapterGroups: ChapterGroup[] = []
  for (const groupEntry of chapterGroupsData) {
    const groupMap = ensureMapping(groupEntry, 'chapterGroup entry')
    const title = requireString(groupMap, 'chapterGroup.title', 'title')
    const widgets = requireList(groupMap, `chapterGroup[${title}].widgets`, 'widgets')
    const chapters = widgets.map((widget) =>
      chapterFromJson(ensureMapping(widget, `widget in group ${title}`), widgetCommonMap, documentMap)
    )
    chapterGroups.push({ title, chapters })
  }

  const subTypes = requireList(brief, 'item.brief.subTypeList', 'subTypeList').map((entry) => {
    const entryMap = ensureMapping(entry, 'subType entry')
    return {
      subTypeId: requireString(entryMap, 'subType.subTypeId', 'subTypeId'),
      value: requireString(entryMap, 'subType.value', 'value'),
    }
  })

  return {
    itemId: requireString(item, 'item.itemId', 'itemId'),
    infoRootMeta,
    publicMeta: omitKeys(item, ['itemId', 'brief', 'document']),
    briefExtra: omitKeys(brief, [
      'name',
      'cover',
      'disableCoverShowInDetail',
      'subTypeList',
      'description',
    ]),
    documentExtraInfo: normalizeMetaRecord(content.extraInfo),
    name: requireString(brief, 'item.brief.name', 'name'),
    cover: requireString(brief, 'item.brief.cover', 'cover'),
    showInDetail: !Boolean(brief.disableCoverShowInDetail),
    subTypes,
    descriptionWasNull: description.wasNull,
    description: description.blocks,
    chapterGroups,
    ...(commitMsg !== undefined ? { commitMsg } : {}),
  }
}

export function documentFromJsonText(source: string | object): [DocumentModel, string[]] {
  const { item, infoRootMeta } = extractInfoItem(parseJsonInput(source))
  return [buildDocumentFromItem(item, infoRootMeta, undefined), []]
}

export function parseSubmitJson(source: string | object): [DocumentModel, string[]] {
  const parsed = ensureMapping(parseJsonInput(source), 'root')

  if (!isRecord(parsed.item) || !isRecord(parsed.item.brief) || !isRecord(parsed.item.document)) {
    throw new EndfieldWikitextConversionError(
      'Submit JSON must be an object containing `item` with `brief` and `document`.'
    )
  }

  const commitMsg = typeof parsed.commitMsg === 'string' ? parsed.commitMsg : undefined
  return [buildDocumentFromItem(parsed.item, {}, commitMsg), []]
}

function buildWikiJsonObject(
  document: DocumentModel,
  options: RenderWikiJsonOptions,
  target: JsonRenderTarget,
) {
  const factory = new IdFactory()
  const widgetCommonMap: Record<string, unknown> = {}
  const documentMap: Record<string, unknown> = {}
  const chapterGroups: Array<Record<string, unknown>> = []

  for (const group of document.chapterGroups) {
    const widgets: Array<Record<string, unknown>> = []
    for (const chapter of group.chapters) {
      const widgetId = factory.widgetId()
      widgets.push({ id: widgetId, title: chapter.title, size: chapter.size })
      widgetCommonMap[widgetId] = chapterToJson(chapter, documentMap, factory, target)
    }
    chapterGroups.push({ title: group.title, widgets })
  }

  const publicMeta = cloneRecord(document.publicMeta)
  publicMeta.name = document.name

  const briefExtra: Record<string, unknown> = {
    associate: null,
    composite: null,
    ...cloneRecord(document.briefExtra),
  }
  delete briefExtra.disableCoverShowInDetail

  const documentExtraInfo = {
    illustration: '',
    showType: '',
    composite: '',
    ...cloneRecord(document.documentExtraInfo),
  }

  const item = {
    itemId: document.itemId,
    ...publicMeta,
    brief: {
      ...briefExtra,
      name: document.name,
      cover: document.cover,
      subTypeList: document.subTypes.map((entry) => ({
        subTypeId: entry.subTypeId,
        value: entry.value,
      })),
      description:
        document.descriptionWasNull && document.description.length === 0
          ? null
          : buildDocumentPayload(document.description, factory),
    },
    document: {
      chapterGroup: chapterGroups,
      extraInfo: documentExtraInfo,
      widgetCommonMap,
      documentMap,
    },
  }

  if (!options.wrapInfoRoot) {
    return item
  }

  return {
    ...cloneRecord(document.infoRootMeta),
    ...(options.envelope ? cloneRecord(options.envelope) : {}),
    data: {
      item,
    },
  }
}

export function documentToWikiJsonObject(
  document: DocumentModel,
  options: RenderWikiJsonOptions = {}
) {
  return buildWikiJsonObject(document, options, 'wiki')
}

export function documentToJsonText(
  document: DocumentModel,
  options: RenderWikiJsonOptions = {}
) {
  const payload = documentToWikiJsonObject(document, options)

  return `${JSON.stringify(payload, null, 4)}\n`
}

export function renderSubmitJson(document: DocumentModel): string {
  const item = buildWikiJsonObject(document, {}, 'submit')
  const payload = {
    commitMsg: document.commitMsg ?? '',
    item,
  }
  return `${JSON.stringify(payload, null, 4)}\n`
}

function chapterFromJson(
  widget: Record<string, unknown>,
  widgetCommonMap: Record<string, unknown>,
  documentMap: Record<string, unknown>
): Chapter {
  const widgetId = requireString(widget, 'widget.id', 'id')
  const title = requireString(widget, `widget[${widgetId}].title`, 'title')
  const size = requireString(widget, `widget[${widgetId}].size`, 'size')
  const common = ensureMapping(widgetCommonMap[widgetId], `widgetCommonMap[${widgetId}]`)
  const chapterType = requireString(common, `widgetCommonMap[${widgetId}].type`, 'type')

  if (chapterType === 'table') {
    const tableEntries = requireList(common, `widgetCommonMap[${widgetId}].tableList`, 'tableList')
    if (tableEntries.length % 2 !== 0) {
      throw new EndfieldWikitextConversionError(
        `Simple table chapter '${title}' must contain an even number of cells.`
      )
    }

    const rows: TableRow[] = []
    for (let index = 0; index < tableEntries.length; index += 2) {
      const first = ensureMapping(tableEntries[index], `table row ${index / 2} cell 1`)
      const second = ensureMapping(tableEntries[index + 1], `table row ${index / 2} cell 2`)
      rows.push({
        cells: [
          [
            requireString(first, 'table cell label', 'label'),
            requireString(first, 'table cell value', 'value'),
          ],
          [
            requireString(second, 'table cell label', 'label'),
            requireString(second, 'table cell value', 'value'),
          ],
        ],
      })
    }

    return {
      title,
      size,
      chapterType: 'simple_table',
      content: [],
      tabs: [],
      audios: [],
      tableRows: rows,
    }
  }

  if (chapterType === 'audio') {
    const widgetLocation = `widgetCommonMap[${widgetId}]`
    const tabDataMap = requireMapping(common, `${widgetLocation}.tabDataMap`, 'tabDataMap')
    const tabList = requireList(common, `${widgetLocation}.tabList`, 'tabList')

    if (tabList.length) {
      const audioTabs: AudioTab[] = tabList.map((tabData, index) => {
        const tabLocation = `${widgetLocation}.tabList[${index}]`
        const tabMap = ensureMapping(tabData, tabLocation)
        const tabId = requireString(tabMap, `${tabLocation}.tabId`, 'tabId')
        const dataLocation = `${widgetLocation}.tabDataMap[${tabId}]`
        const data = ensureMapping(tabDataMap[tabId], dataLocation)
        const audioList = requireList(data, `${dataLocation}.audioList`, 'audioList')

        return {
          title: nullableString(tabMap.title),
          icon: nullableString(tabMap.icon),
          audios: audioItemsFromList(audioList, `${dataLocation}.audioList`),
        }
      })

      return {
        title,
        size,
        chapterType: 'audio',
        content: [],
        tabs: [],
        audios: [],
        audioTabs,
        tableRows: [],
      }
    }

    const defaultLocation = `${widgetLocation}.tabDataMap.default`
    const defaultData = ensureMapping(tabDataMap.default, defaultLocation)
    const audioList = requireList(defaultData, `${defaultLocation}.audioList`, 'audioList')
    const audios = audioItemsFromList(audioList, `${defaultLocation}.audioList`)

    return {
      title,
      size,
      chapterType: 'audio',
      content: [],
      tabs: [],
      audios,
      tableRows: [],
    }
  }

  if (chapterType !== 'common') {
    throw new EndfieldWikitextConversionError(
      `Unsupported widget type '${chapterType}' in chapter '${title}'.`
    )
  }

  const tabDataMap = requireMapping(common, `widgetCommonMap[${widgetId}].tabDataMap`, 'tabDataMap')
  const tabList = requireList(common, `widgetCommonMap[${widgetId}].tabList`, 'tabList')
  if (tabList.length) {
    const tabs: Tab[] = []
    for (const tabData of tabList) {
      const tabMap = ensureMapping(tabData, `tab in chapter ${title}`)
      const tabId = requireString(tabMap, `tab[${title}].tabId`, 'tabId')
      const data = ensureMapping(tabDataMap[tabId], `tabDataMap[${tabId}]`)
      const blocks = chapterContentFromRef(title, tabId, data, documentMap)

      let intro: ImageIntro | null = null
      if (data.intro !== undefined && data.intro !== null) {
        const introMap = ensureMapping(data.intro, `intro in tab ${tabId}`)
        const descriptionId = requireString(introMap, `intro[${tabId}].description`, 'description')
        intro = {
          name: requireString(introMap, 'intro.name', 'name'),
          introType: requireString(introMap, 'intro.type', 'type'),
          imageUrl: requireString(introMap, 'intro.imgUrl', 'imgUrl'),
          description: [],
        }
        if (descriptionId) {
          const descriptionDoc = ensureMapping(documentMap[descriptionId], `documentMap[${descriptionId}]`)
          intro.description = blocksToInlines(blocksFromDocument(descriptionDoc))
        }
      }

      tabs.push({
        title: nullableString(tabMap.title),
        icon: nullableString(tabMap.icon),
        intro,
        content: blocks,
      })
    }

    return {
      title,
      size,
      chapterType: 'common',
      content: [],
      tabs,
      audios: [],
      tableRows: [],
    }
  }

  const defaultData = ensureMapping(tabDataMap.default, `default tabDataMap for chapter ${title}`)
  const content = chapterContentFromRef(title, 'default', defaultData, documentMap)
  return {
    title,
    size,
    chapterType: 'common',
    content,
    tabs: [],
    audios: [],
    tableRows: [],
  }
}

function chapterContentFromRef(
  chapterTitle: string,
  refName: string,
  tabData: Record<string, unknown>,
  documentMap: Record<string, unknown>
): Block[] {
  const documentId = tabData.content
  if (documentId === undefined || documentId === null || documentId === '') {
    return []
  }
  if (typeof documentId !== 'string') {
    throw new EndfieldWikitextConversionError(`Expected string at '${chapterTitle}.${refName}.content'.`)
  }
  const document = ensureMapping(documentMap[documentId], `documentMap[${documentId}]`)
  return blocksFromDocument(document)
}

function blocksFromDocument(document: Record<string, unknown>) {
  const blockIds = requireList(document, 'document.blockIds', 'blockIds')
  const blockMap = requireMapping(document, 'document.blockMap', 'blockMap')
  return normalizeBlocks(
    blockIds.map((blockId) => {
      if (typeof blockId !== 'string') {
        throw new EndfieldWikitextConversionError('Expected block ids to be strings.')
      }
      return blockFromJson(blockId, blockMap, { allowTables: true })
    })
  )
}

function blocksFromChildIds(
  childIds: unknown[],
  blockMap: Record<string, unknown>,
  options: { allowTables: boolean }
) {
  const blocks: Block[] = []
  for (const childId of childIds) {
    if (typeof childId !== 'string') {
      throw new EndfieldWikitextConversionError('Expected child block ids to be strings.')
    }
    blocks.push(blockFromJson(childId, blockMap, options))
  }
  return normalizeBlocks(blocks)
}

function blockFromJson(
  blockId: string,
  blockMap: Record<string, unknown>,
  options: { allowTables: boolean }
): Block {
  const block = ensureMapping(blockMap[blockId], `blockMap[${blockId}]`)
  const kind = requireString(block, `block[${blockId}].kind`, 'kind')

  if (kind === 'text') {
    const textPayload = requireMapping(block, `block[${blockId}].text`, 'text')
    return {
      blockType: 'paragraph',
      kind: requireString(textPayload, `block[${blockId}].text.kind`, 'kind'),
      align: requireString(block, `block[${blockId}].align`, 'align', 'left'),
      inlines: inlinesFromJson(
        requireList(textPayload, `block[${blockId}].text.inlineElements`, 'inlineElements')
      ),
    }
  }

  if (kind === 'quote') {
    const quotePayload = requireMapping(block, `block[${blockId}].quote`, 'quote')
    const childIds = requireList(quotePayload, `block[${blockId}].quote.childIds`, 'childIds')
    return {
      blockType: 'quote',
      children: blocksFromChildIds(childIds, blockMap, options),
    }
  }

  if (kind === 'list') {
    const listPayload = requireMapping(block, `block[${blockId}].list`, 'list')
    const itemIds = requireList(listPayload, `block[${blockId}].list.itemIds`, 'itemIds')
    const itemMap = requireMapping(listPayload, `block[${blockId}].list.itemMap`, 'itemMap')
    const items: ListItem[] = []

    for (const itemId of itemIds) {
      if (typeof itemId !== 'string') {
        throw new EndfieldWikitextConversionError('Expected list item ids to be strings.')
      }
      const item = ensureMapping(itemMap[itemId], `itemMap[${itemId}]`)
      const childIds = requireList(item, `item[${itemId}].childIds`, 'childIds')
      items.push({
        blocks: blocksFromChildIds(childIds, blockMap, options),
      })
    }

    return {
      blockType: 'list',
      ordered: requireString(listPayload, `block[${blockId}].list.kind`, 'kind') === 'ordered',
      items,
    }
  }

  if (kind === 'image') {
    const imagePayload = requireMapping(block, `block[${blockId}].image`, 'image')
    return {
      blockType: 'image',
      url: requireString(imagePayload, 'image.url', 'url'),
      width: requireString(imagePayload, 'image.width', 'width'),
      height: requireString(imagePayload, 'image.height', 'height'),
      size: requireString(imagePayload, 'image.size', 'size'),
      imageId: requireString(imagePayload, 'image.id', 'id'),
      imageFormat: requireString(imagePayload, 'image.format', 'format'),
      description: requireString(imagePayload, 'image.description', 'description', ''),
    }
  }

  if (kind === 'horizontalLine') {
    const linePayload = requireMapping(block, `block[${blockId}].horizontalLine`, 'horizontalLine')
    return {
      blockType: 'horizontalLine',
      kind: requireString(linePayload, 'horizontalLine.kind', 'kind'),
    }
  }

  if (kind === 'externalVideo') {
    const videoPayload = requireMapping(block, `block[${blockId}].externalVideo`, 'externalVideo')
    const videoKind = requireString(videoPayload, `block[${blockId}].externalVideo.kind`, 'kind')
    if (!VIDEO_KINDS.has(videoKind)) {
      throw new EndfieldWikitextConversionError(`Unsupported external video kind '${videoKind}'.`)
    }
    return {
      blockType: 'externalVideo',
      videoKind,
      videoId: requireString(videoPayload, `block[${blockId}].externalVideo.id`, 'id'),
    }
  }

  if (kind === 'table') {
    if (!options.allowTables) {
      throw new EndfieldWikitextConversionError('Nested tables are not supported inside table cells.')
    }
    return tableFromJson(blockId, requireMapping(block, `block[${blockId}].table`, 'table'), blockMap)
  }

  throw new EndfieldWikitextConversionError(`Unsupported JSON block kind '${kind}'.`)
}

function tableFromJson(
  blockId: string,
  tablePayload: Record<string, unknown>,
  blockMap: Record<string, unknown>
): ComplexTableBlock {
  const rowIds = requireList(tablePayload, `table[${blockId}].rowIds`, 'rowIds')
  const columnIds = requireList(tablePayload, `table[${blockId}].columnIds`, 'columnIds')
  const rowMap = new Map<string, number>()
  for (const [index, rowId] of ensureStringList(rowIds, 'table row ids').entries()) {
    rowMap.set(rowId, index)
  }

  const columnMapOrder = ensureStringList(columnIds, 'table column ids')
  const columnMap = requireMapping(tablePayload, `table[${blockId}].columnMap`, 'columnMap')
  const cellMap = requireMapping(tablePayload, `table[${blockId}].cellMap`, 'cellMap')

  const widths: number[] = []
  for (const columnId of columnMapOrder) {
    const column = ensureMapping(columnMap[columnId], `columnMap[${columnId}]`)
    widths.push(Number(requireNumber(column, `columnMap[${columnId}].width`, 'width')))
  }

  const cells: ComplexTableCell[] = []
  for (const [cellKey, rawCell] of Object.entries(cellMap)) {
    const cell = ensureMapping(rawCell, `cellMap[${cellKey}]`)
    const [rowId, columnId] = splitTableCellKey(cellKey)
    const rowIndex = rowMap.get(rowId)
    if (rowIndex === undefined || !columnMapOrder.includes(columnId)) {
      throw new EndfieldWikitextConversionError(`Unknown table cell position '${cellKey}'.`)
    }
    const childIds = requireList(cell, `cellMap[${cellKey}].childIds`, 'childIds')
    cells.push({
      rowIndex,
      columnIndex: columnMapOrder.indexOf(columnId),
      blocks: blocksFromChildIds(childIds, blockMap, { allowTables: false }),
      rowSpan: parseIntValue(cell.rowSpan ?? '1', `cellMap[${cellKey}].rowSpan`),
      colSpan: parseIntValue(cell.colSpan ?? '1', `cellMap[${cellKey}].colSpan`),
    })
  }

  const table: ComplexTableBlock = {
    blockType: 'complexTable',
    headerMode: headerModeFromJson(Boolean(tablePayload.rowHeader), Boolean(tablePayload.colHeader)),
    columnWidths: widths,
    cells: [...cells].sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) {
        return a.rowIndex - b.rowIndex
      }
      return a.columnIndex - b.columnIndex
    }),
    rowCount: rowMap.size,
    columnCount: columnMapOrder.length,
  }

  validateComplexTableBlock(table)
  return table
}

function inlinesFromJson(inlineElements: unknown[]): Inline[] {
  const explicitScaleColors = new Set<string>()
  for (const entry of inlineElements) {
    const entryMap = ensureMapping(entry, 'inline entry')
    if (typeof entryMap.color === 'string' && SCALE_COLOR_SET.has(entryMap.color)) {
      explicitScaleColors.add(entryMap.color)
    }
  }
  const hasExplicitScaleColors = explicitScaleColors.size > 0

  const inlines: Inline[] = []
  for (const rawEntry of inlineElements) {
    const entry = ensureMapping(rawEntry, 'inline entry')
    const kind = requireString(entry, 'inline.kind', 'kind')

    if (kind === 'text') {
      const colorName = typeof entry.color === 'string' ? entry.color : null
      let xmlColor: string | null = null

      if (colorName && !(colorName in JSON_TO_XML_COLOR)) {
        throw new EndfieldWikitextConversionError(`Unsupported JSON color '${colorName}'.`)
      }

      if (colorName && colorName !== DEFAULT_JSON_TEXT_COLOR) {
        xmlColor = JSON_TO_XML_COLOR[colorName]!
      } else if (colorName === DEFAULT_JSON_TEXT_COLOR && hasExplicitScaleColors) {
        xmlColor = JSON_TO_XML_COLOR[colorName]
      }

      const textPayload = requireMapping(entry, 'inline.text', 'text')
      inlines.push(
        textRun(requireString(textPayload, 'inline.text.text', 'text'), {
          bold: Boolean(entry.bold),
          italic: Boolean(entry.italic),
          underline: Boolean(entry.underline),
          strike: Boolean(entry.strikeThrough),
          color: xmlColor,
        })
      )
      continue
    }

    if (kind === 'pronunciation') {
      const pronunciation = requireMapping(entry, 'inline.pronunciation', 'pronunciation')
      inlines.push({
        inlineType: 'pronunciation',
        content: requireString(pronunciation, 'pronunciation.content', 'content'),
      })
      continue
    }

    if (kind === 'link') {
      const link = requireMapping(entry, 'inline.link', 'link')
      inlines.push({
        inlineType: 'link',
        href: requireString(link, 'link.link', 'link'),
        text: requireString(link, 'link.text', 'text'),
      })
      continue
    }

    if (kind === 'entry') {
      const link = requireMapping(entry, 'inline.entry', 'entry')
      const showType = requireString(link, 'entry.showType', 'showType')
      const mappedType = JSON_ENTRY_TO_XML[showType]
      if (!mappedType) {
        throw new EndfieldWikitextConversionError(`Unsupported entry showType '${showType}'.`)
      }
      inlines.push({
        inlineType: 'entry',
        entryType: mappedType,
        targetId: requireString(link, 'entry.id', 'id'),
        count: requireString(link, 'entry.count', 'count'),
      })
      continue
    }

    throw new EndfieldWikitextConversionError(`Unsupported inline kind '${kind}'.`)
  }

  return inlines
}

function chapterToJson(
  chapter: Chapter,
  documentMap: Record<string, unknown>,
  factory: IdFactory,
  target: JsonRenderTarget,
): Record<string, unknown> {
  if (chapter.chapterType === 'simple_table') {
    const tableList: Array<Record<string, string>> = []
    for (const row of chapter.tableRows) {
      if (row.cells.length !== 2) {
        throw new EndfieldWikitextConversionError(
          `Simple table chapter '${chapter.title}' must contain exactly two cells per row.`
        )
      }
      for (const [label, value] of row.cells) {
        tableList.push({ label, value })
      }
    }
    return {
      type: 'table',
      tableList,
      tabList: [],
      tabDataMap: {},
    }
  }

  if (chapter.chapterType === 'audio') {
    const audioTabs = chapter.audioTabs ?? []
    if (audioTabs.length && chapter.audios.length) {
      throw new EndfieldWikitextConversionError(
        `Audio chapter '${chapter.title}' cannot contain both flat audios and audio tabs.`
      )
    }

    if (audioTabs.length) {
      const tabList: Array<Record<string, string>> = []
      const tabDataMap: Record<string, unknown> = {}

      for (const tab of audioTabs) {
        const tabId = factory.tabId()
        tabList.push({
          tabId,
          title: tab.title ?? '',
          icon: tab.icon ?? '',
        })
        tabDataMap[tabId] = {
          intro: null,
          content: '',
          audioList: audioItemsToJson(tab.audios, factory, target),
        }
      }

      return {
        type: 'audio',
        tableList: [],
        tabList,
        tabDataMap,
      }
    }

    return {
      type: 'audio',
      tableList: [],
      tabList: [],
      tabDataMap: {
        default: {
          audioList: audioItemsToJson(chapter.audios, factory, target),
          intro: null,
          content: '',
        },
      },
    }
  }

  if (chapter.chapterType !== 'common') {
    throw new EndfieldWikitextConversionError(`Unsupported chapter type '${chapter.chapterType}'.`)
  }

  if (chapter.tabs.length) {
    const tabList: Array<Record<string, string>> = []
    const tabDataMap: Record<string, unknown> = {}

    for (const tab of chapter.tabs) {
      const tabId = factory.tabId()
      const tabDescriptor: Record<string, string> = {
        tabId,
        title: tab.title ?? '',
        icon: tab.icon ?? '',
      }
      tabList.push(tabDescriptor)

      const tabPayload: Record<string, unknown> = {
        content: tab.content.length ? storeDocument(tab.content, documentMap, factory) : '',
        audioList: [],
        intro: null,
      }

      if (tab.intro !== null) {
        // Split the intro description inlines on `\n` so each line becomes
        // its own paragraph block — the wiki renders one block per line,
        // so a `\n` inside a single text run would be collapsed to a space.
        const introBlocks = tab.intro.description.length
          ? splitInlinesByNewline(tab.intro.description).map((line) => paragraph(line))
          : []

        tabPayload.intro = {
          name: tab.intro.name,
          type: tab.intro.introType,
          imgUrl: tab.intro.imageUrl,
          description: storeDocument(introBlocks, documentMap, factory),
        }
      }

      tabDataMap[tabId] = tabPayload
    }

    return {
      type: 'common',
      tableList: [],
      tabList,
      tabDataMap,
    }
  }

  const tabData: Record<string, unknown> = {
    audioList: [],
    intro: null,
    content: '',
  }
  if (chapter.content.length) {
    tabData.content = storeDocument(chapter.content, documentMap, factory)
  }

  return {
    type: 'common',
    tableList: [],
    tabList: [],
    tabDataMap: {
      default: tabData,
    },
  }
}

function audioItemsToJson(
  audios: AudioItem[],
  factory: IdFactory,
  target: JsonRenderTarget,
) {
  return audios.map((entry) => ({
    title: entry.title,
    profile: entry.profile,
    resourceUrl: entry.resourceUrl,
    ...(target === 'submit' ? { id: factory.audioId() } : {}),
  }))
}

function storeDocument(
  blocks: Block[],
  documentMap: Record<string, unknown>,
  factory: IdFactory
): string {
  const documentId = factory.widgetId()
  documentMap[documentId] = buildDocumentPayload(blocks, factory)
  return documentId
}

function buildDocumentPayload(blocks: Block[], factory: IdFactory): Record<string, unknown> {
  const blockIds: string[] = []
  const blockMap: Record<string, unknown> = {}

  for (const block of normalizeBlocks(blocks)) {
    const blockId = appendBlock(block, blockMap, 'document-id', factory)
    blockIds.push(blockId)
  }

  return {
    id: 'document-id',
    blockIds,
    blockMap,
    authorMap: {},
    version: '1.0.0',
  }
}

function appendBlock(
  block: Block,
  blockMap: Record<string, unknown>,
  parentId: string,
  factory: IdFactory
): string {
  if (isExternalVideo(block)) {
    const blockId = block.videoId
    blockMap[blockId] = {
      kind: 'externalVideo',
      id: blockId,
      parentId,
      externalVideo: {
        id: blockId,
        kind: block.videoKind,
        elementId: factory.elementId(),
        type: 'external-video',
        children: [{ text: '' }],
      },
    }
    return blockId
  }

  const blockId = factory.blockId()

  if (isParagraph(block)) {
    blockMap[blockId] = {
      id: blockId,
      parentId,
      align: block.align,
      kind: 'text',
      text: {
        inlineElements: block.inlines.map((inline) => inlineToJson(inline)),
        kind: block.kind,
      },
    }
    return blockId
  }

  if (isQuote(block)) {
    const childIds = normalizeBlocks(block.children).map((child) =>
      appendBlock(child, blockMap, blockId, factory)
    )
    blockMap[blockId] = {
      id: blockId,
      parentId,
      kind: 'quote',
      quote: {
        childIds,
      },
    }
    return blockId
  }

  if (isList(block)) {
    const itemIds: string[] = []
    const itemMap: Record<string, unknown> = {}

    for (const item of block.items) {
      const itemId = factory.itemId()
      itemIds.push(itemId)
      const childIds = normalizeBlocks(item.blocks).map((child) =>
        appendBlock(child, blockMap, itemId, factory)
      )
      itemMap[itemId] = {
        id: itemId,
        childIds,
      }
    }

    blockMap[blockId] = {
      id: blockId,
      parentId,
      kind: 'list',
      list: {
        id: blockId,
        itemIds,
        itemMap,
        kind: block.ordered ? 'ordered' : 'unordered',
      },
    }
    return blockId
  }

  if (isImage(block)) {
    blockMap[blockId] = {
      id: blockId,
      parentId,
      kind: 'image',
      image: {
        id: block.imageId,
        url: block.url,
        width: block.width,
        height: block.height,
        size: block.size,
        format: block.imageFormat,
        kind: '',
        description: block.description,
        status: '',
        infos: [],
      },
    }
    return blockId
  }

  if (block.blockType === 'horizontalLine') {
    blockMap[blockId] = {
      id: blockId,
      parentId,
      kind: 'horizontalLine',
      horizontalLine: {
        kind: block.kind,
      },
    }
    return blockId
  }

  if (isComplexTable(block)) {
    validateComplexTableBlock(block)
    const rowIds = Array.from({ length: block.rowCount }, () => factory.itemId())
    const columnIds = Array.from({ length: block.columnCount }, () => factory.itemId())

    const rowMap: Record<string, unknown> = {}
    for (const rowId of rowIds) {
      rowMap[rowId] = { id: rowId }
    }

    const columnMap: Record<string, unknown> = {}
    for (let i = 0; i < columnIds.length; i += 1) {
      const columnId = columnIds[i]!
      columnMap[columnId] = {
        id: columnId,
        width: block.columnWidths[i],
      }
    }

    const cellMap: Record<string, unknown> = {}
    for (const cell of [...block.cells].sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) {
        return a.rowIndex - b.rowIndex
      }
      return a.columnIndex - b.columnIndex
    })) {
      const rowId = rowIds[cell.rowIndex]!
      const columnId = columnIds[cell.columnIndex]!
      const cellId = `${rowId}_${columnId}`
      const childIds = normalizeBlocks(cell.blocks).map((child) =>
        appendBlock(child, blockMap, cellId, factory)
      )

      cellMap[cellId] = {
        id: cellId,
        childIds,
        rowSpan: String(cell.rowSpan),
        colSpan: String(cell.colSpan),
        borderKind: '',
        borderColor: '',
        backgroundColor: '',
        verticalAlign: 'unknown',
      }
    }

    blockMap[blockId] = {
      id: blockId,
      parentId,
      kind: 'table',
      table: {
        id: blockId,
        rowIds,
        columnIds,
        rowMap,
        columnMap,
        cellMap,
        description: '',
        rowHeader: block.headerMode === 'row' || block.headerMode === 'both',
        colHeader: block.headerMode === 'col' || block.headerMode === 'both',
      },
    }
    return blockId
  }

  throw new EndfieldWikitextConversionError(`Unsupported block type '${(block as Block).blockType}'.`)
}

/**
 * Split a sequence of inlines on `\n` boundaries inside text runs, producing
 * one Inline[] per line. Used for imgIntro descriptions where each line must
 * become its own block so the wiki renders line breaks correctly.
 */
function splitInlinesByNewline(inlines: Inline[]): Inline[][] {
  const lines: Inline[][] = [[]]
  for (const inline of inlines) {
    if (!isTextRun(inline)) {
      lines[lines.length - 1]!.push(inline)
      continue
    }

    const normalized = inline.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = normalized.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([])
      }
      const part = parts[i]!
      // Drop empty text that comes from leading/trailing newlines —
      // those just separate lines and shouldn't produce empty text runs.
      if (part === '') {
        continue
      }
      lines[lines.length - 1]!.push(textRun(part, {
        bold: inline.bold,
        italic: inline.italic,
        underline: inline.underline,
        strike: inline.strike,
        color: inline.color,
      }))
    }
  }
  return lines
}

function inlineToJson(inline: Inline): Record<string, unknown> {
  if (isTextRun(inline)) {
    const payload: Record<string, unknown> = {
      kind: 'text',
      text: {
        text: inline.text,
      },
    }

    if (inline.bold) {
      payload.bold = true
    }
    if (inline.italic) {
      payload.italic = true
    }
    if (inline.underline) {
      payload.underline = true
    }
    if (inline.strike) {
      payload.strikeThrough = true
    }
    if (inline.color !== null) {
      const mapped = XML_TO_JSON_COLOR[inline.color]
      if (!mapped) {
        throw new EndfieldWikitextConversionError(`Unsupported XML color '${inline.color}'.`)
      }
      payload.color = mapped
    }

    return payload
  }

  if (inline.inlineType === 'pronunciation') {
    return {
      kind: 'pronunciation',
      pronunciation: {
        content: inline.content,
      },
    }
  }

  if (inline.inlineType === 'link') {
    return {
      kind: 'link',
      link: {
        link: inline.href,
        text: inline.text,
      },
    }
  }

  if (inline.inlineType === 'entry') {
    const mappedType = XML_ENTRY_TO_JSON[inline.entryType]
    if (!mappedType) {
      throw new EndfieldWikitextConversionError(`Unsupported entry type '${inline.entryType}'.`)
    }

    return {
      kind: 'entry',
      entry: {
        id: inline.targetId,
        showType: mappedType,
        count: inline.count,
      },
    }
  }

  throw new EndfieldWikitextConversionError('Unsupported inline type.')
}
