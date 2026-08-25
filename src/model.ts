export class XmlWikiConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlWikiConversionError'
  }
}

const EndfieldWikitextConversionError = XmlWikiConversionError
export { XmlWikiConversionError as EndfieldWikitextConversionError }

export const HEADER_MODES = new Set(['none', 'row', 'col', 'both'])

export interface SubType {
  subTypeId: string
  value: string
}

export interface TextRunInline {
  inlineType: 'text'
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string | null
}

export interface PronunciationInline {
  inlineType: 'pronunciation'
  content: string
}

export interface LinkInline {
  inlineType: 'link'
  href: string
  text: string
}

export interface EntryRefInline {
  inlineType: 'entry'
  entryType: string
  targetId: string
  count: string
}

export type Inline = TextRunInline | PronunciationInline | LinkInline | EntryRefInline

export interface ParagraphBlock {
  blockType: 'paragraph'
  kind: string
  align: string
  inlines: Inline[]
}

export interface QuoteBlock {
  blockType: 'quote'
  children: Block[]
}

export interface ListItem {
  blocks: Block[]
}

export interface ListBlock {
  blockType: 'list'
  ordered: boolean
  items: ListItem[]
}

export interface ImageBlock {
  blockType: 'image'
  url: string
  width: string
  height: string
  size: string
  imageId: string
  imageFormat: string
  description: string
}

export interface HorizontalLineBlock {
  blockType: 'horizontalLine'
  kind: string
}

export interface ExternalVideoBlock {
  blockType: 'externalVideo'
  videoKind: string
  videoId: string
}

export interface ComplexTableCell {
  rowIndex: number
  columnIndex: number
  blocks: Block[]
  rowSpan: number
  colSpan: number
}

export interface ComplexTableBlock {
  blockType: 'complexTable'
  headerMode: string
  columnWidths: number[]
  cells: ComplexTableCell[]
  rowCount: number
  columnCount: number
}

export type Block =
  | ParagraphBlock
  | QuoteBlock
  | ListBlock
  | ImageBlock
  | HorizontalLineBlock
  | ComplexTableBlock
  | ExternalVideoBlock

export interface ImageIntro {
  name: string
  introType: string
  imageUrl: string
  description: Inline[]
}

export interface Tab {
  title: string | null
  icon: string | null
  intro: ImageIntro | null
  content: Block[]
}

export interface AudioItem {
  title: string
  profile: string
  resourceUrl: string
}

export interface AudioTab {
  title: string | null
  icon: string | null
  audios: AudioItem[]
}

export interface TableRow {
  cells: Array<[string, string]>
}

export interface Chapter {
  title: string
  size: string
  chapterType: string
  content: Block[]
  tabs: Tab[]
  audios: AudioItem[]
  audioTabs?: AudioTab[]
  tableRows: TableRow[]
}

export interface ChapterGroup {
  title: string
  chapters: Chapter[]
}

export interface DocumentModel {
  itemId: string
  infoRootMeta: Record<string, unknown>
  publicMeta: Record<string, unknown>
  briefExtra: Record<string, unknown>
  documentExtraInfo: Record<string, unknown>
  name: string
  cover: string
  showInDetail: boolean
  subTypes: SubType[]
  descriptionWasNull: boolean
  description: Block[]
  chapterGroups: ChapterGroup[]
  commitMsg?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isParagraph(block: Block): block is ParagraphBlock {
  return block.blockType === 'paragraph'
}

export function isQuote(block: Block): block is QuoteBlock {
  return block.blockType === 'quote'
}

export function isList(block: Block): block is ListBlock {
  return block.blockType === 'list'
}

export function isImage(block: Block): block is ImageBlock {
  return block.blockType === 'image'
}

export function isComplexTable(block: Block): block is ComplexTableBlock {
  return block.blockType === 'complexTable'
}

export function isExternalVideo(block: Block): block is ExternalVideoBlock {
  return block.blockType === 'externalVideo'
}

export function isTextRun(inline: Inline): inline is TextRunInline {
  return inline.inlineType === 'text'
}

export function textRun(text: string, options?: Partial<Omit<TextRunInline, 'inlineType' | 'text'>>): TextRunInline {
  return {
    inlineType: 'text',
    text,
    bold: options?.bold ?? false,
    italic: options?.italic ?? false,
    underline: options?.underline ?? false,
    strike: options?.strike ?? false,
    color: options?.color ?? null,
  }
}

export function paragraph(inlines: Inline[] = [], kind = 'body', align = 'left'): ParagraphBlock {
  return {
    blockType: 'paragraph',
    kind,
    align,
    inlines,
  }
}

export function isHeaderPosition(headerMode: string, rowIndex: number, columnIndex: number) {
  if (headerMode === 'none') {
    return false
  }
  if (headerMode === 'row') {
    return rowIndex === 0
  }
  if (headerMode === 'col') {
    return columnIndex === 0
  }
  if (headerMode === 'both') {
    return rowIndex === 0 || columnIndex === 0
  }
  throw new EndfieldWikitextConversionError(`Unsupported table header mode '${headerMode}'.`)
}

export function inlineHasContent(inline: Inline) {
  if (isTextRun(inline)) {
    return Boolean(inline.text)
  }
  if (inline.inlineType === 'pronunciation') {
    return Boolean(inline.content)
  }
  if (inline.inlineType === 'link') {
    return Boolean(inline.text || inline.href)
  }
  return Boolean(inline.targetId)
}

export function isEmptyParagraph(block: Block) {
  return (
    isParagraph(block) &&
    block.kind === 'body' &&
    !block.inlines.some((inline) => inlineHasContent(inline))
  )
}

export function mergeAdjacentTextRuns(inlines: Inline[]) {
  const merged: Inline[] = []
  for (const inline of inlines) {
    const last = merged[merged.length - 1]
    if (
      last &&
      isTextRun(last) &&
      isTextRun(inline) &&
      last.bold === inline.bold &&
      last.italic === inline.italic &&
      last.underline === inline.underline &&
      last.strike === inline.strike &&
      last.color === inline.color
    ) {
      last.text += inline.text
      continue
    }
    merged.push(inline)
  }
  return merged
}

export function normalizeBlocks(blocks: Block[]): Block[] {
  const normalized: Block[] = []

  for (const block of blocks) {
    if (isParagraph(block)) {
      const nextParagraph = paragraph(mergeAdjacentTextRuns(block.inlines), block.kind, block.align)
      if (nextParagraph.kind === 'body' && nextParagraph.align !== 'left' && !nextParagraph.inlines.length) {
        continue
      }
      if (nextParagraph.kind !== 'body' && !nextParagraph.inlines.length) {
        continue
      }
      normalized.push(nextParagraph)
      continue
    }

    if (isQuote(block)) {
      const children = normalizeBlocks(block.children)
      if (children.length) {
        normalized.push({
          blockType: 'quote',
          children,
        })
      }
      continue
    }

    if (isList(block)) {
      const items: ListItem[] = []
      for (const item of block.items) {
        const itemBlocks = normalizeBlocks(item.blocks)
        if (itemBlocks.length) {
          items.push({ blocks: itemBlocks })
        }
      }
      if (items.length) {
        normalized.push({
          blockType: 'list',
          ordered: block.ordered,
          items,
        })
      }
      continue
    }

    if (isComplexTable(block)) {
      const cells = [...block.cells]
        .sort((a, b) => {
          if (a.rowIndex !== b.rowIndex) {
            return a.rowIndex - b.rowIndex
          }
          return a.columnIndex - b.columnIndex
        })
        .map((cell) => ({
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
          blocks: normalizeBlocks(cell.blocks),
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan,
        }))

      const nextTable: ComplexTableBlock = {
        blockType: 'complexTable',
        headerMode: block.headerMode,
        columnWidths: [...block.columnWidths],
        cells,
        rowCount: block.rowCount,
        columnCount: block.columnCount,
      }
      validateComplexTableBlock(nextTable)
      normalized.push(nextTable)
      continue
    }

    normalized.push(block)
  }

  while (normalized.length > 0 && isEmptyParagraph(normalized[0]!)) {
    normalized.shift()
  }

  while (normalized.length > 0 && isEmptyParagraph(normalized[normalized.length - 1]!)) {
    normalized.pop()
  }

  const collapsed: Block[] = []
  for (const block of normalized) {
    const last = collapsed[collapsed.length - 1]
    if (last && isEmptyParagraph(last) && isEmptyParagraph(block)) {
      continue
    }
    collapsed.push(block)
  }

  return collapsed
}

export function blocksToPlainText(blocks: Block[]) {
  const lines: string[] = []
  for (const block of normalizeBlocks(blocks)) {
    if (isParagraph(block)) {
      lines.push(inlinesToPlainText(block.inlines))
    }
  }
  return lines.join('\n')
}

/**
 * Extract a flat Inline[] from paragraph blocks, inserting `\n` text runs
 * between paragraphs. This preserves inline formatting (bold, italic, color,
 * etc.) that {@link blocksToPlainText} discards. Used when importing imgIntro
 * descriptions from JSON, where each line is stored as a separate paragraph
 * block.
 */
export function blocksToInlines(blocks: Block[]): Inline[] {
  const inlines: Inline[] = []
  for (const block of normalizeBlocks(blocks)) {
    if (isParagraph(block)) {
      inlines.push(...block.inlines)
      inlines.push(textRun('\n'))
    }
  }
  // Drop trailing `\n` separator added after the last paragraph.
  const last = inlines[inlines.length - 1]
  if (last && isTextRun(last) && last.text === '\n') {
    inlines.pop()
  }
  return mergeAdjacentTextRuns(inlines)
}

export function inlinesToPlainText(inlines: Inline[]) {
  const parts: string[] = []
  for (const inline of inlines) {
    if (isTextRun(inline)) {
      parts.push(inline.text)
    } else if (inline.inlineType === 'pronunciation') {
      parts.push(inline.content)
    } else if (inline.inlineType === 'link') {
      parts.push(inline.text)
    } else {
      parts.push('')
    }
  }
  return parts.join('')
}

export function* iterImageBlocks(blocks: Block[]): Generator<ImageBlock> {
  for (const block of blocks) {
    if (isImage(block)) {
      yield block
      continue
    }

    if (isQuote(block)) {
      yield* iterImageBlocks(block.children)
      continue
    }

    if (isList(block)) {
      for (const item of block.items) {
        yield* iterImageBlocks(item.blocks)
      }
      continue
    }

    if (isComplexTable(block)) {
      for (const cell of block.cells) {
        yield* iterImageBlocks(cell.blocks)
      }
    }
  }
}

export function validateComplexTableBlock(block: ComplexTableBlock) {
  if (!HEADER_MODES.has(block.headerMode)) {
    throw new EndfieldWikitextConversionError(`Unsupported table header mode '${block.headerMode}'.`)
  }
  if (block.rowCount <= 0 || block.columnCount <= 0) {
    throw new EndfieldWikitextConversionError(
      'Complex tables must contain at least one row and one column.'
    )
  }
  if (block.columnWidths.length !== block.columnCount) {
    throw new EndfieldWikitextConversionError(
      `Complex table column widths length ${block.columnWidths.length} does not match column count ${block.columnCount}.`
    )
  }

  for (let i = 0; i < block.columnWidths.length; i += 1) {
    const width = block.columnWidths[i]!
    if (!Number.isFinite(width) || width <= 0) {
      throw new EndfieldWikitextConversionError(
        `Complex table column ${i + 1} width ${width} must be a positive number.`
      )
    }
  }

  const occupied = new Map<string, ComplexTableCell>()

  for (const cell of block.cells) {
    if (cell.rowIndex < 0 || cell.columnIndex < 0) {
      throw new EndfieldWikitextConversionError('Complex table cell positions must be non-negative.')
    }
    if (cell.rowSpan < 1 || cell.colSpan < 1) {
      throw new EndfieldWikitextConversionError(
        'Complex table cell spans must be positive integers.'
      )
    }
    if (cell.rowIndex + cell.rowSpan > block.rowCount) {
      throw new EndfieldWikitextConversionError('Complex table cell row span exceeds the table bounds.')
    }
    if (cell.columnIndex + cell.colSpan > block.columnCount) {
      throw new EndfieldWikitextConversionError(
        'Complex table cell column span exceeds the table bounds.'
      )
    }

    for (let rowIndex = cell.rowIndex; rowIndex < cell.rowIndex + cell.rowSpan; rowIndex += 1) {
      for (
        let columnIndex = cell.columnIndex;
        columnIndex < cell.columnIndex + cell.colSpan;
        columnIndex += 1
      ) {
        const key = `${rowIndex}:${columnIndex}`
        occupied.set(key, cell)
      }
    }
  }

  for (let rowIndex = 0; rowIndex < block.rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < block.columnCount; columnIndex += 1) {
      const key = `${rowIndex}:${columnIndex}`
      if (!occupied.has(key)) {
        throw new EndfieldWikitextConversionError('Complex table contains uncovered grid positions.')
      }
    }
  }

  for (const cell of block.cells) {
    for (const image of iterImageBlocks(cell.blocks)) {
      const imageWidth = Number.parseFloat(image.width)
      if (!Number.isFinite(imageWidth)) {
        throw new EndfieldWikitextConversionError(`Image width '${image.width}' is not numeric.`)
      }
    }
  }
}
