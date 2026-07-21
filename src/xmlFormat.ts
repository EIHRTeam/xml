import { XML_TO_JSON_COLOR } from './colors'
import { BASE_BLOCK_TAGS, INLINE_TAGS, TABLE_TOTAL_WIDTH_BY_SIZE, VIDEO_KINDS } from './constants'
import { hasMeta, normalizeMetaRecord, type XmlPublicMeta } from './publicMeta'
import { CDATA_SECTION_NODE, ELEMENT_NODE, TEXT_NODE, parseXmlDocument } from './xmlDom'
import {
  AudioItem,
  Block,
  Chapter,
  ChapterGroup,
  ComplexTableBlock,
  ComplexTableCell,
  DocumentModel,
  EndfieldWikitextConversionError,
  EntryRefInline,
  HEADER_MODES,
  ImageBlock,
  ImageIntro,
  Inline,
  LinkInline,
  ListBlock,
  ListItem,
  PronunciationInline,
  QuoteBlock,
  SubType,
  Tab,
  TableRow,
  TextRunInline,
  isComplexTable,
  isExternalVideo,
  isImage,
  isHeaderPosition,
  isRecord,
  isList,
  isParagraph,
  isQuote,
  isTextRun,
  mergeAdjacentTextRuns,
  normalizeBlocks,
  paragraph,
  textRun,
  validateComplexTableBlock,
} from './model'

function parseXmlRoot(source: string): Element {
  let xml: Document
  try {
    xml = parseXmlDocument(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EndfieldWikitextConversionError(message || 'Invalid XML.')
  }
  const parserError = xml.getElementsByTagName('parsererror')[0]
  if (parserError) {
    throw new EndfieldWikitextConversionError(
      normalizedText(parserError.textContent, 'Invalid XML.')
    )
  }
  const root = xml.documentElement
  if (!root) {
    throw new EndfieldWikitextConversionError('Invalid XML.')
  }
  return root
}

function childElements(element: Element): Element[] {
  const children: Element[] = []
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === ELEMENT_NODE) {
      children.push(node as Element)
    }
  }
  return children
}

function directTextContent(element: Element): string {
  let text = ''
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      text += node.nodeValue || ''
    }
  }
  return text
}

function normalizedText(text: string | null | undefined, defaultValue = '') {
  if (text == null) {
    return defaultValue
  }
  return text.replace(/\s+/g, ' ').trim()
}

function normalizedMultilineText(text: string | null | undefined) {
  if (text == null) {
    return ''
  }

  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())

  while (lines.length > 0 && !lines[0]) {
    lines.shift()
  }
  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop()
  }
  return lines.join('\n')
}

function elementHasContent(element: Element) {
  if (directTextContent(element).trim()) {
    return true
  }
  return childElements(element).length > 0
}

function requireChild(parent: Element, tag: string): Element {
  for (const child of childElements(parent)) {
    if (child.tagName === tag) {
      return child
    }
  }
  throw new EndfieldWikitextConversionError(`Expected <${tag}> inside <${parent.tagName}>.`)
}

function childrenByTag(parent: Element, tag: string): Element[] {
  return childElements(parent).filter((child) => child.tagName === tag)
}

function optionalChild(parent: Element, tag: string): Element | null {
  for (const child of childElements(parent)) {
    if (child.tagName === tag) {
      return child
    }
  }
  return null
}

function parsePublicMeta(root: Element): Required<XmlPublicMeta> {
  const metaElement = optionalChild(root, 'publicMeta')
  if (!metaElement) {
    return {
      infoRoot: {},
      item: {},
      brief: {},
      documentExtraInfo: {},
    }
  }

  const text = directTextContent(metaElement).trim()
  if (!text) {
    return {
      infoRoot: {},
      item: {},
      brief: {},
      documentExtraInfo: {},
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EndfieldWikitextConversionError(`Invalid <publicMeta> JSON: ${message}`)
  }

  if (!isRecord(parsed)) {
    throw new EndfieldWikitextConversionError('<publicMeta> must contain a JSON object.')
  }

  const itemMeta = normalizeMetaRecord(parsed.item ?? parsed)
  delete itemMeta.commitMsg

  return {
    infoRoot: normalizeMetaRecord(parsed.infoRoot),
    item: itemMeta,
    brief: normalizeMetaRecord(parsed.brief),
    documentExtraInfo: normalizeMetaRecord(parsed.documentExtraInfo),
  }
}

export function documentFromXmlText(source: string): [DocumentModel, string[]] {
  const root = parseXmlRoot(source)
  if (root.tagName !== 'sklandDocument') {
    throw new EndfieldWikitextConversionError('Expected root element <sklandDocument>.')
  }

  const publicMeta = parsePublicMeta(root)
  const commitMsgEl = optionalChild(root, 'commitMsg')
  const metainfo = requireChild(root, 'metainfo')
  const cover = requireChild(metainfo, 'cover')
  const subTypesContainer = requireChild(metainfo, 'subTypes')
  const descriptionElement = requireChild(root, 'description')

  const chapterGroups: ChapterGroup[] = []
  for (const group of childrenByTag(root, 'chapters')) {
    const title = group.getAttribute('name')
    if (title == null) {
      throw new EndfieldWikitextConversionError('Each <chapters> element must have a name attribute.')
    }
    const chapters = childrenByTag(group, 'chapter').map((chapter) => chapterFromXml(chapter))
    chapterGroups.push({
      title,
      chapters,
    })
  }

  const subTypes: SubType[] = childrenByTag(subTypesContainer, 'subType').map((entry) => {
    const id = entry.getAttribute('id')
    if (id == null) {
      throw new EndfieldWikitextConversionError('<subType> must include an id attribute.')
    }

    return {
      subTypeId: id,
      value: directTextContent(entry),
    }
  })

  return [
    {
      itemId: normalizedText(directTextContent(requireChild(root, 'itemId'))),
      infoRootMeta: publicMeta.infoRoot,
      publicMeta: publicMeta.item,
      briefExtra: publicMeta.brief,
      documentExtraInfo: publicMeta.documentExtraInfo,
      name: directTextContent(requireChild(metainfo, 'name')),
      cover: directTextContent(cover),
      showInDetail: (cover.getAttribute('showInDetail') || 'false').toLowerCase() === 'true',
      subTypes,
      descriptionWasNull:
        (descriptionElement.getAttribute('source') || '').toLowerCase() === 'null',
      description: parseMixedBlocks(descriptionElement, { allowTables: true }),
      chapterGroups,
      ...(commitMsgEl ? { commitMsg: directTextContent(commitMsgEl) } : {}),
    },
    [],
  ]
}

function chapterFromXml(chapter: Element): Chapter {
  const title = chapter.getAttribute('name')
  if (title == null) {
    throw new EndfieldWikitextConversionError('Each <chapter> element must have a name attribute.')
  }
  const size = chapter.getAttribute('size') || ''

  if (chapter.getAttribute('table') === 'true') {
    const table = requireChild(chapter, 'table')
    const rows: TableRow[] = []
    for (const [index, row] of childrenByTag(table, 'row').entries()) {
      const cells = childrenByTag(row, 'cell')
      if (cells.length !== 2) {
        throw new EndfieldWikitextConversionError(
          `Simple table chapter '${title}' row ${index + 1} must contain exactly 2 cells.`
        )
      }

      rows.push({
        cells: cells.map((cell) => [cell.getAttribute('label') || '', normalizedText(directTextContent(cell))]),
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

  if (chapter.getAttribute('audio') === 'true') {
    const audiosContainer = requireChild(chapter, 'audios')
    const audios = childrenByTag(audiosContainer, 'audio').map((audio) => ({
      title: audio.getAttribute('name') || '',
      profile: normalizedMultilineText(directTextContent(audio)),
      resourceUrl: audio.getAttribute('src') || '',
    }))

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

  const tabs = childrenByTag(chapter, 'tab')
  if (tabs.length) {
    return {
      title,
      size,
      chapterType: 'common',
      content: [],
      tabs: tabs.map((tab) => tabFromXml(tab, size)),
      audios: [],
      tableRows: [],
    }
  }

  return {
    title,
    size,
    chapterType: 'common',
    content: parseMixedBlocks(chapter, { chapterSize: size, allowTables: true }),
    tabs: [],
    audios: [],
    tableRows: [],
  }
}

function tabFromXml(tab: Element, chapterSize: string): Tab {
  let intro: ImageIntro | null = null

  const content = parseMixedBlocks(tab, {
    chapterSize,
    allowTables: true,
    specialHandlers: {
      imgIntro: (child) => {
        intro = {
          name: normalizedText(directTextContent(requireChild(child, 'name'))),
          introType: normalizedText(directTextContent(requireChild(child, 'type'))),
          imageUrl: normalizedText(directTextContent(requireChild(child, 'imgUrl'))),
          description: parseInlineContainer(requireChild(child, 'description')),
        }
      },
    },
  })

  return {
    title: tab.getAttribute('name'),
    icon: tab.getAttribute('icon'),
    intro,
    content,
  }
}

function parseMixedBlocks(
  container: Element,
  options?: {
    specialHandlers?: Record<string, (element: Element) => void>
    chapterSize?: string
    allowTables?: boolean
  }
): Block[] {
  const specialHandlers = options?.specialHandlers || {}
  const chapterSize = options?.chapterSize
  const allowTables = options?.allowTables ?? true

  const blocks: Block[] = []
  let currentInlines: Inline[] | null = null

  const ensureCurrent = () => {
    if (!currentInlines) {
      currentInlines = []
    }
    return currentInlines
  }

  const flushCurrent = (addEmpty = false) => {
    if (!currentInlines) {
      if (addEmpty && blocks.length > 0 && !isEmptyBodyParagraph(blocks[blocks.length - 1]!)) {
        blocks.push(paragraph())
      }
      return
    }

    blocks.push(paragraph(mergeAdjacentTextRuns(currentInlines)))
    currentInlines = null
  }

  const consumeText = (text: string | null | undefined) => {
    if (!text) {
      return
    }

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!normalized.trim()) {
      const newlineCount = (normalized.match(/\n/g) || []).length
      if (newlineCount >= 1 && currentInlines) {
        flushCurrent()
      }
      if (newlineCount > 1) {
        flushCurrent(true)
      }
      return
    }

    const parts = normalized.split('\n')
    let seenContent = false
    let blankRun = 0

    for (const [index, part] of parts.entries()) {
      const stripped = part.trim()
      if (stripped) {
        if (!seenContent && currentInlines) {
          if (blankRun >= 1) {
            flushCurrent()
          }
          if (blankRun > 1) {
            flushCurrent(true)
          }
        }

        if (seenContent && blankRun > 1) {
          flushCurrent(true)
        }

        ensureCurrent().push(textRun(stripped))
        // Only close the paragraph when a newline actually follows this text
        // (i.e. it is not the final part). Otherwise a following inline sibling
        // on the same line — e.g. `完成主线任务<entry/>` — would be orphaned into
        // its own paragraph instead of staying inline with the text.
        if (index < parts.length - 1) {
          flushCurrent()
        }
        seenContent = true
        blankRun = 0
      } else if (seenContent || currentInlines) {
        blankRun += 1
      }
    }

    if (blankRun > 1) {
      flushCurrent(true)
    }
  }

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      consumeText(node.nodeValue)
      continue
    }

    if (node.nodeType !== ELEMENT_NODE) {
      continue
    }

    const child = node as Element
    const tag = child.tagName

    if (specialHandlers[tag]) {
      flushCurrent()
      specialHandlers[tag]!(child)
      continue
    }

    if (INLINE_TAGS.has(tag)) {
      ensureCurrent().push(...parseInlineElement(child))
      continue
    }

    if (BASE_BLOCK_TAGS.has(tag) || (allowTables && tag === 'table')) {
      flushCurrent()
      blocks.push(
        parseBlockElement(child, {
          chapterSize,
          allowTables,
        })
      )
      continue
    }

    if (tag === 'table' && !allowTables) {
      throw new EndfieldWikitextConversionError('Nested tables are not supported inside table cells.')
    }

    if (elementHasContent(child)) {
      throw new EndfieldWikitextConversionError(`Unsupported XML tag <${tag}> in content container.`)
    }
  }

  flushCurrent()
  return normalizeBlocks(blocks)
}

function parseBlockElement(
  element: Element,
  options: {
    chapterSize?: string
    allowTables: boolean
  }
): Block {
  if (element.tagName === 'h1') {
    return {
      blockType: 'paragraph',
      kind: 'heading1',
      align: 'left',
      inlines: parseInlineContainer(element),
    }
  }

  if (element.tagName === 'h2') {
    return {
      blockType: 'paragraph',
      kind: 'heading2',
      align: 'left',
      inlines: parseInlineContainer(element),
    }
  }

  if (element.tagName === 'h3') {
    return {
      blockType: 'paragraph',
      kind: 'heading3',
      align: 'left',
      inlines: parseInlineContainer(element),
    }
  }

  if (element.tagName === 'quote') {
    return {
      blockType: 'quote',
      children: parseMixedBlocks(element, {
        chapterSize: options.chapterSize,
        allowTables: options.allowTables,
      }),
    }
  }

  if (element.tagName === 'ul') {
    return parseListElement(element, {
      ordered: false,
      chapterSize: options.chapterSize,
      allowTables: options.allowTables,
    })
  }

  if (element.tagName === 'ol') {
    return parseListElement(element, {
      ordered: true,
      chapterSize: options.chapterSize,
      allowTables: options.allowTables,
    })
  }

  if (element.tagName === 'align') {
    return {
      blockType: 'paragraph',
      kind: 'body',
      align: element.getAttribute('value') || 'left',
      inlines: parseInlineContainer(element),
    }
  }

  if (element.tagName === 'img') {
    const url = normalizedText(directTextContent(requireChild(element, 'url')))
    const explicitId = optionalChild(element, 'id')
    const explicitFormat = optionalChild(element, 'format')
    const inferredParts = explicitId && explicitFormat ? null : inferImageParts(url)
    return {
      blockType: 'image',
      url,
      width: normalizedText(directTextContent(requireChild(element, 'width'))),
      height: normalizedText(directTextContent(requireChild(element, 'height'))),
      size: normalizedText(directTextContent(requireChild(element, 'size'))),
      imageId: explicitId ? normalizedText(directTextContent(explicitId)) : inferredParts![0],
      imageFormat: explicitFormat ? normalizedText(directTextContent(explicitFormat)) : inferredParts![1],
      description: normalizedText(directTextContent(requireChild(element, 'description')), ''),
    }
  }

  if (element.tagName === 'line') {
    return {
      blockType: 'horizontalLine',
      kind: element.getAttribute('kind') || '',
    }
  }

  if (element.tagName === 'video') {
    const videoKind = element.getAttribute('kind')
    if (!videoKind) {
      throw new EndfieldWikitextConversionError('<video> must include a kind attribute.')
    }
    if (!VIDEO_KINDS.has(videoKind)) {
      throw new EndfieldWikitextConversionError(`Unsupported external video kind '${videoKind}'.`)
    }
    const videoId = element.getAttribute('id')
    if (!videoId) {
      throw new EndfieldWikitextConversionError('<video> must include an id attribute.')
    }
    return {
      blockType: 'externalVideo',
      videoKind,
      videoId,
    }
  }

  if (element.tagName === 'table') {
    if (!options.allowTables) {
      throw new EndfieldWikitextConversionError('Nested tables are not supported inside table cells.')
    }
    return parseComplexTable(element, options.chapterSize)
  }

  throw new EndfieldWikitextConversionError(`Unsupported block tag <${element.tagName}>.`)
}

function parseComplexTable(element: Element, chapterSize?: string): ComplexTableBlock {
  if (!chapterSize) {
    throw new EndfieldWikitextConversionError(
      'Complex tables require a chapter size to derive default widths.'
    )
  }

  const headerMode = (element.getAttribute('header') || 'none').trim() || 'none'
  if (!HEADER_MODES.has(headerMode)) {
    throw new EndfieldWikitextConversionError(`Unsupported table header mode '${headerMode}'.`)
  }

  const rowElements = childrenByTag(element, 'tr')
  if (!rowElements.length) {
    throw new EndfieldWikitextConversionError('Complex tables must contain at least one <tr>.')
  }

  const occupied = new Map<string, { rowIndex: number; columnIndex: number }>()
  const parsedCells: ComplexTableCell[] = []
  let columnCount = 0

  for (const [rowIndex, rowElement] of rowElements.entries()) {
    const rowWidth = (rowElement.getAttribute('width') || '').trim()
    if (rowWidth) {
      throw new EndfieldWikitextConversionError(
        'Row-level width is not supported; use the table widths attribute instead.'
      )
    }

    let seenElement = false
    let columnIndex = 0

    for (const node of Array.from(rowElement.childNodes)) {
      if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
        const text = (node.nodeValue || '').trim()
        if (text) {
          throw new EndfieldWikitextConversionError(
            seenElement
              ? 'Unexpected trailing text inside a table row.'
              : 'Unexpected text directly inside a table row.'
          )
        }
        continue
      }

      if (node.nodeType !== ELEMENT_NODE) {
        continue
      }

      seenElement = true
      const child = node as Element
      if (child.tagName !== 'td' && child.tagName !== 'th') {
        if (elementHasContent(child)) {
          throw new EndfieldWikitextConversionError(`Unsupported tag <${child.tagName}> inside <tr>.`)
        }
        continue
      }

      while (occupied.has(`${rowIndex}:${columnIndex}`)) {
        columnIndex += 1
      }
      const explicitColumn = child.getAttribute('col')
      if (explicitColumn !== null) {
        columnIndex = parsePositiveInt(explicitColumn, `row ${rowIndex + 1} col`) - 1
      }

      const rowSpan = parsePositiveInt(
        (child.getAttribute('rowspan') || '1').trim(),
        `row ${rowIndex + 1} rowspan`
      )
      const colSpan = parsePositiveInt(
        (child.getAttribute('colspan') || '1').trim(),
        `row ${rowIndex + 1} colspan`
      )

      const blocks = parseMixedBlocks(child, {
        chapterSize,
        allowTables: false,
      })

      const isHeader = child.tagName === 'th'
      const expectedHeader = isHeaderPosition(headerMode, rowIndex, columnIndex)
      if (isHeader !== expectedHeader) {
        throw new EndfieldWikitextConversionError(
          `Table header mode '${headerMode}' conflicts with cell at row ${rowIndex + 1}, column ${columnIndex + 1}.`
        )
      }

      parsedCells.push({
        rowIndex,
        columnIndex,
        rowSpan,
        colSpan,
        blocks,
      })

      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          const key = `${rowIndex + rowOffset}:${columnIndex + columnOffset}`
          occupied.set(key, { rowIndex, columnIndex })
        }
      }

      columnIndex += colSpan
    }

    while (occupied.has(`${rowIndex}:${columnIndex}`)) {
      columnIndex += 1
    }
    columnCount = Math.max(columnCount, columnIndex)
  }

  const widths = parseColumnWidths(element.getAttribute('widths'), chapterSize, columnCount)
  const table: ComplexTableBlock = {
    blockType: 'complexTable',
    headerMode,
    columnWidths: widths,
    cells: parsedCells,
    rowCount: rowElements.length,
    columnCount,
  }
  validateComplexTableBlock(table)
  return table
}

function parseListElement(
  element: Element,
  options: {
    ordered: boolean
    chapterSize?: string
    allowTables: boolean
  }
): ListBlock {
  const headText = directTextContent(element).trim()
  if (headText) {
    throw new EndfieldWikitextConversionError('Unexpected text directly inside a list container.')
  }

  const items: ListItem[] = []
  let currentItem: ListItem | null = null

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      const text = (node.nodeValue || '').trim()
      if (text) {
        throw new EndfieldWikitextConversionError('Unexpected trailing text after a list child element.')
      }
      continue
    }

    if (node.nodeType !== ELEMENT_NODE) {
      continue
    }

    const child = node as Element
    if (child.tagName === 'li') {
      let blocks = parseMixedBlocks(child, {
        chapterSize: options.chapterSize,
        allowTables: options.allowTables,
      })
      if (!blocks.length) {
        blocks = [paragraph()]
      }
      currentItem = { blocks }
      items.push(currentItem)
      continue
    }

    if (child.tagName === 'ul' || child.tagName === 'ol') {
      if (!currentItem) {
        throw new EndfieldWikitextConversionError('Nested list must follow a list item.')
      }
      currentItem.blocks.push(
        parseListElement(child, {
          ordered: child.tagName === 'ol',
          chapterSize: options.chapterSize,
          allowTables: options.allowTables,
        })
      )
      continue
    }

    if (elementHasContent(child)) {
      throw new EndfieldWikitextConversionError(`Unsupported tag <${child.tagName}> inside list.`)
    }
  }

  return {
    blockType: 'list',
    ordered: options.ordered,
    items,
  }
}

function parseInlineContainer(
  element: Element,
  state?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    color?: string | null
  }
): Inline[] {
  const bold = state?.bold ?? false
  const italic = state?.italic ?? false
  const underline = state?.underline ?? false
  const strike = state?.strike ?? false
  const color = state?.color ?? null

  const inlines: Inline[] = []

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      appendInlineText(inlines, node.nodeValue, {
        bold,
        italic,
        underline,
        strike,
        color,
      })
      continue
    }

    if (node.nodeType !== ELEMENT_NODE) {
      continue
    }

    inlines.push(
      ...parseInlineElement(node as Element, {
        bold,
        italic,
        underline,
        strike,
        color,
      })
    )
  }

  return mergeAdjacentTextRuns(inlines)
}

function parseInlineElement(
  element: Element,
  state?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    color?: string | null
  }
): Inline[] {
  const bold = state?.bold ?? false
  const italic = state?.italic ?? false
  const underline = state?.underline ?? false
  const strike = state?.strike ?? false
  const color = state?.color ?? null

  if (element.tagName === 'b') {
    return parseInlineContainer(element, { bold: true, italic, underline, strike, color })
  }

  if (element.tagName === 'i') {
    return parseInlineContainer(element, { bold, italic: true, underline, strike, color })
  }

  if (element.tagName === 'u') {
    return parseInlineContainer(element, { bold, italic, underline: true, strike, color })
  }

  if (element.tagName === 's') {
    return parseInlineContainer(element, { bold, italic, underline, strike: true, color })
  }

  if (element.tagName === 'color') {
    const colorValue = element.getAttribute('value')
    if (!colorValue) {
      throw new EndfieldWikitextConversionError('<color> must include a value attribute.')
    }
    if (!XML_TO_JSON_COLOR[colorValue]) {
      throw new EndfieldWikitextConversionError(`Unsupported XML color '${colorValue}'.`)
    }
    return parseInlineContainer(element, {
      bold,
      italic,
      underline,
      strike,
      color: colorValue,
    })
  }

  if (element.tagName === 'pron') {
    return [
      {
        inlineType: 'pronunciation',
        content: normalizedText(element.textContent),
      },
    ]
  }

  if (element.tagName === 'a') {
    return [
      {
        inlineType: 'link',
        href: element.getAttribute('href') || '',
        text: normalizedText(element.textContent),
      },
    ]
  }

  if (element.tagName === 'entry') {
    const entryType = element.getAttribute('type')
    if (!entryType) {
      throw new EndfieldWikitextConversionError('<entry> must include a type attribute.')
    }
    return [
      {
        inlineType: 'entry',
        entryType,
        targetId: element.getAttribute('id') || '',
        count: element.getAttribute('count') || '0',
      },
    ]
  }

  throw new EndfieldWikitextConversionError(`Unsupported inline tag <${element.tagName}>.`)
}

function appendInlineText(
  inlines: Inline[],
  text: string | null | undefined,
  state: {
    bold: boolean
    italic: boolean
    underline: boolean
    strike: boolean
    color: string | null
  }
) {
  if (!text) {
    return
  }

  // Preserve newlines (they are significant in imgIntro descriptions),
  // but collapse all other whitespace runs to a single space.
  // Note: we do NOT trim newlines — only spaces/tabs — so that a leading
  // "\n获取方式：..." keeps its line break.
  const collapsed = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/^[^\S\n]+/, '')
    .replace(/[^\S\n]+$/, '')
  if (!collapsed) {
    return
  }

  inlines.push(
    textRun(collapsed, {
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
      strike: state.strike,
      color: state.color,
    })
  )
}

export function documentToXmlText(document: DocumentModel): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<sklandDocument>']
  lines.push(`    <itemId>${escapeXmlText(document.itemId)}</itemId>`)
  if (document.commitMsg !== undefined) {
    lines.push(`    <commitMsg>${escapeXmlText(document.commitMsg)}</commitMsg>`)
  }
  const meta = {
    infoRoot: document.infoRootMeta,
    item: document.publicMeta,
    brief: document.briefExtra,
    documentExtraInfo: document.documentExtraInfo,
  }
  if (
    hasMeta(meta.infoRoot) ||
    hasMeta(meta.item) ||
    hasMeta(meta.brief) ||
    hasMeta(meta.documentExtraInfo)
  ) {
    lines.push(`    <publicMeta>${escapeXmlText(JSON.stringify(meta))}</publicMeta>`)
  }
  lines.push('    <metainfo>')
  lines.push(`        <name>${escapeXmlText(document.name)}</name>`)
  lines.push(
    `        <cover showInDetail="${String(document.showInDetail).toLowerCase()}">${escapeXmlText(document.cover)}</cover>`
  )
  lines.push('        <subTypes>')
  for (const subType of document.subTypes) {
    lines.push(
      `            <subType id=${quoteAttr(subType.subTypeId)}>${escapeXmlText(subType.value)}</subType>`
    )
  }
  lines.push('        </subTypes>')
  lines.push('    </metainfo>')
  lines.push(
    ...renderBlockContainer(
      'description',
      document.descriptionWasNull && document.description.length === 0 ? { source: 'null' } : {},
      document.description,
      4
    )
  )
  for (const group of document.chapterGroups) {
    lines.push(...renderChapterGroup(group, 4))
  }
  lines.push('</sklandDocument>')
  return `${lines.join('\n')}\n`
}

function renderChapterGroup(group: ChapterGroup, indent: number) {
  const pad = ' '.repeat(indent)
  const lines = [`${pad}<chapters name=${quoteAttr(group.title)}>`]
  for (const chapter of group.chapters) {
    lines.push(...renderChapter(chapter, indent + 4))
  }
  lines.push(`${pad}</chapters>`)
  return lines
}

function renderChapter(chapter: Chapter, indent: number) {
  const attrs: Record<string, string> = {
    size: chapter.size,
    name: chapter.title,
  }

  if (chapter.chapterType === 'simple_table') {
    attrs.table = 'true'
  } else if (chapter.chapterType === 'audio') {
    attrs.audio = 'true'
  }

  const lines = openContainer('chapter', attrs, indent)

  if (chapter.chapterType === 'simple_table') {
    lines.push(...renderSimpleTable(chapter.tableRows, indent + 4))
  } else if (chapter.chapterType === 'audio') {
    lines.push(...renderAudioList(chapter.audios, indent + 4))
  } else if (chapter.tabs.length) {
    for (const tab of chapter.tabs) {
      lines.push(...renderTab(tab, indent + 4))
    }
  } else {
    lines.push(...renderBlocks(chapter.content, indent + 4))
  }

  lines.push(`${' '.repeat(indent)}</chapter>`)
  return lines
}

function renderTab(tab: Tab, indent: number) {
  const attrs: Record<string, string> = {}
  if (tab.title !== null) {
    attrs.name = tab.title
  }
  if (tab.icon !== null) {
    attrs.icon = tab.icon
  }

  const lines = openContainer('tab', attrs, indent)
  if (tab.intro !== null) {
    lines.push(...renderImageIntro(tab.intro, indent + 4))
  }
  lines.push(...renderBlocks(tab.content, indent + 4))
  lines.push(`${' '.repeat(indent)}</tab>`)
  return lines
}

function renderImageIntro(intro: ImageIntro, indent: number) {
  const pad = ' '.repeat(indent)
  return [
    `${pad}<imgIntro>`,
    `${pad}    <name>${escapeXmlText(intro.name)}</name>`,
    `${pad}    <type>${escapeXmlText(intro.introType)}</type>`,
    `${pad}    <imgUrl>${escapeXmlText(intro.imageUrl)}</imgUrl>`,
    `${pad}    <description>${renderInlines(intro.description)}</description>`,
    `${pad}</imgIntro>`,
  ]
}

function renderAudioList(audios: AudioItem[], indent: number) {
  const pad = ' '.repeat(indent)
  const lines = [`${pad}<audios>`]

  for (const audio of audios) {
    const attrs = `name=${quoteAttr(audio.title)} src=${quoteAttr(audio.resourceUrl)}`
    lines.push(`${pad}    <audio ${attrs}>`)
    const profileLines = audio.profile ? audio.profile.split('\n') : []
    for (const line of profileLines) {
      lines.push(`${pad}        ${escapeXmlText(line)}`)
    }
    lines.push(`${pad}    </audio>`)
  }

  lines.push(`${pad}</audios>`)
  return lines
}

function renderSimpleTable(rows: TableRow[], indent: number) {
  const pad = ' '.repeat(indent)
  const lines = [`${pad}<table>`]

  for (const row of rows) {
    if (row.cells.length !== 2) {
      throw new EndfieldWikitextConversionError('Simple table rows must contain exactly two cells.')
    }
    lines.push(`${pad}    <row>`)
    for (const [label, value] of row.cells) {
      lines.push(`${pad}        <cell label=${quoteAttr(label)}>${escapeXmlText(value)}</cell>`)
    }
    lines.push(`${pad}    </row>`)
  }

  lines.push(`${pad}</table>`)
  return lines
}

function renderBlockContainer(
  tag: string,
  attrs: Record<string, string>,
  blocks: Block[],
  indent: number
) {
  const lines = openContainer(tag, attrs, indent)
  lines.push(...renderBlocks(blocks, indent + 4))
  lines.push(`${' '.repeat(indent)}</${tag}>`)
  return lines
}

function renderBlocks(blocks: Block[], indent: number) {
  const lines: string[] = []
  for (const block of normalizeBlocks(blocks)) {
    lines.push(...renderBlock(block, indent))
  }
  return lines
}

function renderBlock(block: Block, indent: number): string[] {
  const pad = ' '.repeat(indent)

  if (isParagraph(block)) {
    if (block.kind === 'body') {
      if (block.align !== 'left') {
        if (!block.inlines.length) {
          return []
        }
        return [
          `${pad}<align value=${quoteAttr(block.align)}>${renderInlines(block.inlines)}</align>`,
        ]
      }

      if (!block.inlines.length) {
        return ['']
      }

      return [`${pad}${renderInlines(block.inlines)}`]
    }

    const headingTagMap: Record<string, string> = {
      heading1: 'h1',
      heading2: 'h2',
      heading3: 'h3',
    }

    const tag = headingTagMap[block.kind]
    if (!tag) {
      throw new EndfieldWikitextConversionError(
        `Unsupported paragraph kind '${block.kind}' for XML rendering.`
      )
    }

    return [`${pad}<${tag}>${renderInlines(block.inlines)}</${tag}>`]
  }

  if (isQuote(block)) {
    const lines = [`${pad}<quote>`]
    lines.push(...renderBlocks(block.children, indent + 4))
    lines.push(`${pad}</quote>`)
    return lines
  }

  if (isList(block)) {
    const tag = block.ordered ? 'ol' : 'ul'
    const lines = [`${pad}<${tag}>`]

    for (const item of block.items) {
      lines.push(...renderListItem(item, indent + 4))
    }

    lines.push(`${pad}</${tag}>`)
    return lines
  }

  if (isImage(block)) {
    return [
      `${pad}<img>`,
      `${pad}    <id>${escapeXmlText(block.imageId)}</id>`,
      `${pad}    <format>${escapeXmlText(block.imageFormat)}</format>`,
      `${pad}    <width>${escapeXmlText(block.width)}</width>`,
      `${pad}    <height>${escapeXmlText(block.height)}</height>`,
      `${pad}    <size>${escapeXmlText(block.size)}</size>`,
      `${pad}    <url>${escapeXmlText(block.url)}</url>`,
      `${pad}    <description>${escapeXmlText(block.description)}</description>`,
      `${pad}</img>`,
    ]
  }

  if (block.blockType === 'horizontalLine') {
    return [`${pad}<line kind=${quoteAttr(block.kind)}></line>`]
  }

  if (isExternalVideo(block)) {
    return [`${pad}<video kind=${quoteAttr(block.videoKind)} id=${quoteAttr(block.videoId)}></video>`]
  }

  if (isComplexTable(block)) {
    return renderComplexTable(block, indent)
  }

  throw new EndfieldWikitextConversionError(`Unsupported block type '${(block as Block).blockType}'.`)
}

function renderComplexTable(block: ComplexTableBlock, indent: number) {
  validateComplexTableBlock(block)

  const pad = ' '.repeat(indent)
  const widths = block.columnWidths.map((width) => formatWidth(width)).join(',')
  const lines = [`${pad}<table header=${quoteAttr(block.headerMode)} widths=${quoteAttr(widths)}>`]
  const cellsByRow = new Map<number, ComplexTableCell[]>()
  for (const cell of block.cells) {
    const rowCells = cellsByRow.get(cell.rowIndex) || []
    rowCells.push(cell)
    cellsByRow.set(cell.rowIndex, rowCells)
  }

  for (let rowIndex = 0; rowIndex < block.rowCount; rowIndex += 1) {
    lines.push(`${pad}    <tr>`)
    const rowCells = [...(cellsByRow.get(rowIndex) || [])].sort((a, b) => a.columnIndex - b.columnIndex)

    for (const cell of rowCells) {
      const columnIndex = cell.columnIndex
      const tag = isHeaderPosition(block.headerMode, rowIndex, columnIndex) ? 'th' : 'td'
      const attrs: Record<string, string> = {
        col: String(cell.columnIndex + 1),
      }
      if (cell.rowSpan !== 1) {
        attrs.rowspan = String(cell.rowSpan)
      }
      if (cell.colSpan !== 1) {
        attrs.colspan = String(cell.colSpan)
      }

      const renderedAttrs = Object.entries(attrs)
        .map(([name, value]) => ` ${name}=${quoteAttr(value)}`)
        .join('')
      const renderedBlocks = renderBlocks(cell.blocks, indent + 12)

      if (renderedBlocks.length) {
        lines.push(`${pad}        <${tag}${renderedAttrs}>`)
        lines.push(...renderedBlocks)
        lines.push(`${pad}        </${tag}>`)
      } else {
        lines.push(`${pad}        <${tag}${renderedAttrs}></${tag}>`)
      }
    }

    lines.push(`${pad}    </tr>`)
  }

  lines.push(`${pad}</table>`)
  return lines
}

function renderInlines(inlines: Inline[]) {
  return inlines.map((inline) => renderInline(inline)).join('')
}

function renderInline(inline: Inline) {
  if (isTextRun(inline)) {
    let value = escapeXmlText(inline.text)
    if (inline.color !== null) {
      value = `<color value=${quoteAttr(inline.color)}>${value}</color>`
    }
    if (inline.underline) {
      value = `<u>${value}</u>`
    }
    if (inline.strike) {
      value = `<s>${value}</s>`
    }
    if (inline.italic) {
      value = `<i>${value}</i>`
    }
    if (inline.bold) {
      value = `<b>${value}</b>`
    }
    return value
  }

  if (inline.inlineType === 'pronunciation') {
    return `<pron>${escapeXmlText(inline.content)}</pron>`
  }

  if (inline.inlineType === 'link') {
    return `<a href=${quoteAttr(inline.href)}>${escapeXmlText(inline.text)}</a>`
  }

  if (inline.inlineType === 'entry') {
    return `<entry type=${quoteAttr(inline.entryType)} count=${quoteAttr(inline.count)} id=${quoteAttr(inline.targetId)}></entry>`
  }

  throw new EndfieldWikitextConversionError('Unsupported inline type.')
}

function renderListItem(item: ListItem, indent: number): string[] {
  const blocks = normalizeBlocks(item.blocks)
  if (!blocks.length) {
    return [`${' '.repeat(indent)}<li></li>`]
  }

  const lines: string[] = []
  for (const block of blocks) {
    if (isList(block)) {
      lines.push(...renderBlock(block, indent))
      continue
    }

    lines.push(...renderListItemContentBlock(block, indent))
  }
  return lines
}

function renderListItemContentBlock(block: Block, indent: number): string[] {
  const pad = ' '.repeat(indent)
  if (isParagraph(block) && block.kind === 'body' && block.align === 'left') {
    return [
      block.inlines.length ? `${pad}<li>${renderInlines(block.inlines)}</li>` : `${pad}<li></li>`,
    ]
  }

  const lines = [`${pad}<li>`]
  lines.push(...renderBlock(block, indent + 4))
  lines.push(`${pad}</li>`)
  return lines
}

function openContainer(tag: string, attrs: Record<string, string>, indent: number) {
  const pad = ' '.repeat(indent)
  const renderedAttrs = Object.entries(attrs)
    .map(([name, value]) => ` ${name}=${quoteAttr(value)}`)
    .join('')
  return [`${pad}<${tag}${renderedAttrs}>`]
}

function inferImageParts(url: string): [string, string] {
  const filename = url.split('/').pop() || ''
  if (!filename.includes('_') || !filename.includes('.')) {
    throw new EndfieldWikitextConversionError(
      `Could not infer image id and format from url '${url}'.`
    )
  }

  const separatorIndex = filename.indexOf('_')
  const dotIndex = filename.lastIndexOf('.')
  return [filename.slice(0, separatorIndex), filename.slice(dotIndex + 1)]
}

function parseColumnWidths(widthsAttr: string | null, chapterSize: string, columnCount: number) {
  if (columnCount <= 0) {
    throw new EndfieldWikitextConversionError('Complex tables must contain at least one column.')
  }

  let widths: number[]
  if (!widthsAttr || !widthsAttr.trim()) {
    const totalWidth = TABLE_TOTAL_WIDTH_BY_SIZE[chapterSize]
    if (totalWidth == null) {
      throw new EndfieldWikitextConversionError(
        `Unsupported chapter size '${chapterSize}' for default table widths.`
      )
    }
    const width = totalWidth / columnCount
    widths = Array.from({ length: columnCount }, () => width)
  } else {
    const parts = widthsAttr.split(',').map((part) => part.trim())
    if (parts.length !== columnCount) {
      throw new EndfieldWikitextConversionError(
        `Table widths count ${parts.length} does not match logical column count ${columnCount}.`
      )
    }

    widths = parts.map((part, index) => {
      const parsed = Number.parseFloat(part)
      if (!Number.isFinite(parsed)) {
        throw new EndfieldWikitextConversionError(
          `Table width '${part}' for column ${index + 1} is not numeric.`
        )
      }
      return parsed
    })
  }

  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index]!
    if (!Number.isFinite(width) || width <= 0) {
      throw new EndfieldWikitextConversionError(
        `Table column ${index + 1} width ${width} must be a positive number.`
      )
    }
  }

  return widths
}

function parsePositiveInt(value: string, location: string) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed)) {
    throw new EndfieldWikitextConversionError(`Expected integer for ${location}.`)
  }
  if (parsed < 1) {
    throw new EndfieldWikitextConversionError(`Expected positive integer for ${location}.`)
  }
  return parsed
}

function formatWidth(width: number) {
  const text = Number(width).toString()
  if (text.endsWith('.0')) {
    return text.slice(0, -2)
  }
  return text
}

function isEmptyBodyParagraph(block: Block) {
  return isParagraph(block) && block.kind === 'body' && block.inlines.length === 0
}

function escapeXmlText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeXmlAttr(value: string) {
  return escapeXmlText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function quoteAttr(value: string) {
  return `"${escapeXmlAttr(value)}"`
}
