import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom'

import {
  parseWikiJson,
  parseXml,
  wikiJsonToXml,
  xmlToWikiJson,
  XmlWikiConversionError,
  type Block,
  type DocumentModel,
} from '../src'

const fixturePath = resolve(import.meta.dirname, 'fixtures/item-info.response.sample.json')
const sampleXmlPath = resolve(import.meta.dirname, 'fixtures/sample.xml')
const infoRootText = readFileSync(fixturePath, 'utf8')
const sampleXmlText = readFileSync(sampleXmlPath, 'utf8')
const infoRoot = JSON.parse(infoRootText) as Record<string, unknown>
const infoItem = (infoRoot.data as { item: Record<string, unknown> }).item

function collectBlocks(document: DocumentModel) {
  const blocks: Block[] = []
  const visit = (block: Block) => {
    blocks.push(block)
    if (block.blockType === 'quote') {
      block.children.forEach(visit)
    } else if (block.blockType === 'list') {
      for (const item of block.items) {
        item.blocks.forEach(visit)
      }
    } else if (block.blockType === 'complexTable') {
      for (const cell of block.cells) {
        cell.blocks.forEach(visit)
      }
    }
  }
  document.description.forEach(visit)
  for (const group of document.chapterGroups) {
    for (const chapter of group.chapters) {
      chapter.content.forEach(visit)
      for (const tab of chapter.tabs) {
        tab.content.forEach(visit)
      }
    }
  }
  return blocks
}

describe('@eihrteam/xml conversion', () => {
  test('converts InfoRoot to XML and back to semantic InfoItem', () => {
    const sourceDocument = parseWikiJson(infoRootText)
    const xml = wikiJsonToXml(infoRootText).text

    expect(xml).toContain('<sklandDocument>')
    expect(xml).toContain('<publicMeta>')
    expect(xml).not.toContain('<commitMsg>')
    expect(parseXml(xml)).toEqual(sourceDocument)

    const renderedItem = JSON.parse(xmlToWikiJson(xml).text) as Record<string, unknown>
    const roundTripDocument = parseWikiJson(renderedItem)

    expect(roundTripDocument).toEqual({ ...sourceDocument, infoRootMeta: {} })
    expect(renderedItem).toHaveProperty('brief')
    expect(renderedItem).toHaveProperty('document')
    expect(renderedItem).not.toHaveProperty('item')
  })

  test('accepts a bare InfoItem input', () => {
    const xml = wikiJsonToXml(infoItem).text
    const renderedItem = JSON.parse(xmlToWikiJson(xml).text) as Record<string, unknown>

    expect(parseWikiJson(renderedItem)).toEqual(parseWikiJson(infoItem))
  })

  test('can render an InfoRoot envelope when requested', () => {
    const xml = wikiJsonToXml(infoRootText).text
    const renderedRoot = JSON.parse(xmlToWikiJson(xml, { wrapInfoRoot: true }).text) as {
      code: number
      message: string
      data: { item: Record<string, unknown> }
    }

    expect(renderedRoot.code).toBe(infoRoot.code)
    expect(renderedRoot.message).toBe(infoRoot.message)
    expect(renderedRoot.data.item.itemId).toBe(infoItem.itemId)
  })

  test('preserves public metadata and public read-model padding', () => {
    const xml = wikiJsonToXml(infoRootText).text
    const renderedItem = JSON.parse(xmlToWikiJson(xml).text) as Record<string, any>

    expect(renderedItem.lang).toBe(infoItem.lang)
    expect(renderedItem.status).toBe(infoItem.status)
    expect(renderedItem.createdUser).toEqual(infoItem.createdUser)
    expect(renderedItem.brief.associate).toBeNull()
    expect(renderedItem.brief.composite).toBeNull()
    expect(renderedItem.document.extraInfo.showType).toBe('')
    expect(renderedItem.document.extraInfo.composite).toBe('')
  })

  test('preserves null public brief descriptions', () => {
    const payload = structuredClone(infoRoot) as Record<string, any>
    payload.data.item.brief.description = null

    const sourceDocument = parseWikiJson(payload)
    const xml = wikiJsonToXml(payload).text
    const renderedItem = JSON.parse(xmlToWikiJson(xml).text) as Record<string, any>

    expect(sourceDocument.descriptionWasNull).toBe(true)
    expect(xml).toContain('<description source="null">')
    expect(parseXml(xml)).toEqual(sourceDocument)
    expect(renderedItem.brief.description).toBeNull()
  })

  test('parses common block families from the fixture', () => {
    const document = parseXml(sampleXmlText)
    const blocks = collectBlocks(document)

    expect(blocks.some((block) => block.blockType === 'paragraph')).toBe(true)
    expect(blocks.some((block) => block.blockType === 'quote')).toBe(true)
    expect(blocks.some((block) => block.blockType === 'list')).toBe(true)
    expect(blocks.some((block) => block.blockType === 'image')).toBe(true)
    expect(blocks.some((block) => block.blockType === 'complexTable')).toBe(true)
    expect(document.chapterGroups.some((group) =>
      group.chapters.some((chapter) => chapter.chapterType === 'audio')
    )).toBe(true)
    expect(document.chapterGroups.some((group) =>
      group.chapters.some((chapter) => chapter.chapterType === 'simple_table')
    )).toBe(true)
  })

  test('uses the Node XML parser when DOMParser is not global', () => {
    expect((globalThis as { DOMParser?: unknown }).DOMParser).toBeUndefined()

    const xml = wikiJsonToXml(infoRootText).text
    expect(parseXml(xml).itemId).toBe(String(infoItem.itemId))
  })

  test('uses a browser-like global DOMParser when present', () => {
    const original = (globalThis as { DOMParser?: unknown }).DOMParser
    const parseSpy = vi.fn()

    class BrowserLikeDOMParser extends XmldomDOMParser {
      parseFromString(source: string, mimeType: string) {
        parseSpy(mimeType)
        return super.parseFromString(source, mimeType)
      }
    }

    ;(globalThis as { DOMParser?: unknown }).DOMParser = BrowserLikeDOMParser
    try {
      const xml = wikiJsonToXml(infoRootText).text
      expect(parseXml(xml).itemId).toBe(String(infoItem.itemId))
      expect(parseSpy).toHaveBeenCalledWith('application/xml')
    } finally {
      ;(globalThis as { DOMParser?: unknown }).DOMParser = original
    }
  })

  test('rejects invalid XML and unsupported content tags', () => {
    expect(() => parseXml('<sklandDocument>')).toThrow(XmlWikiConversionError)
    expect(() =>
      parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<sklandDocument>
  <itemId>1</itemId>
  <metainfo>
    <name>n</name>
    <cover showInDetail="true">https://example.com/cover.png</cover>
    <subTypes></subTypes>
  </metainfo>
  <description><unknown>bad</unknown></description>
</sklandDocument>`)
    ).toThrow(XmlWikiConversionError)
  })

  test('accepts public-page edge cases used by TheSklandDataSource', () => {
    const document = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<sklandDocument>
    <itemId>1</itemId>
    <metainfo>
        <name> Leading Name</name>
        <cover showInDetail="true">https://example.com/cover.png</cover>
        <subTypes></subTypes>
    </metainfo>
    <description></description>
    <chapters name="edge">
        <chapter name="" size="2x3">
            <img>
                <id>image-id</id>
                <format>webp</format>
                <width>100</width>
                <height>100</height>
                <size>1</size>
                <url>https://example.com/no-inferable-name.webp</url>
                <description></description>
            </img>
            <table header="none" widths="96.66666666666667,193.33333333333334">
                <tr>
                    <td col="1">a</td>
                    <td col="2">b</td>
                </tr>
            </table>
        </chapter>
    </chapters>
</sklandDocument>`)

    expect(document.name).toBe(' Leading Name')
    expect(document.chapterGroups[0]?.chapters[0]?.title).toBe('')
    expect(collectBlocks(document).some((block) => block.blockType === 'image')).toBe(true)
    expect(collectBlocks(document).some((block) => block.blockType === 'complexTable')).toBe(true)
  })

  test('rejects wiki JSON without the public item shape', () => {
    expect(() => parseWikiJson({ itemId: '1' })).toThrow(XmlWikiConversionError)
  })
})
