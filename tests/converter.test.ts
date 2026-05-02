import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom'

import {
  parseSubmitJson,
  parseWikiJson,
  parseXml,
  renderSubmitJson,
  submitJsonToWikiJson,
  submitJsonToXml,
  wikiJsonToSubmitJson,
  wikiJsonToXml,
  wikiJsonToXmlBatch,
  xmlToSubmitJson,
  xmlToWikiJson,
  xmlToWikiJsonBatch,
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

  test('renders every wiki JSON list content block as a li element', () => {
    const payload = structuredClone(infoRoot) as Record<string, any>
    const overviewDoc = payload.data.item.document.documentMap['doc-overview']
    const blockMap = {
      'overview-list': {
        id: 'overview-list',
        parentId: 'doc-overview',
        kind: 'list',
        list: {
          id: 'overview-list',
          kind: 'unordered',
          itemIds: ['list-item'],
          itemMap: {
            'list-item': {
              id: 'list-item',
              childIds: ['list-line-1', 'list-line-2', 'list-line-3', 'list-line-4'],
            },
          },
        },
      },
      'list-line-1': {
        id: 'list-line-1',
        parentId: 'list-item',
        align: 'left',
        kind: 'text',
        text: {
          kind: 'body',
          inlineElements: [{ kind: 'text', text: { text: '枢纽区' } }],
        },
      },
      'list-line-2': {
        id: 'list-line-2',
        parentId: 'list-item',
        align: 'left',
        kind: 'text',
        text: {
          kind: 'body',
          inlineElements: [
            {
              kind: 'text',
              bold: true,
              color: 'light_rank_yellow',
              text: { text: '待建设区' },
            },
            { kind: 'text', text: { text: '极其容易获取。' } },
          ],
        },
      },
      'list-line-3': {
        id: 'list-line-3',
        parentId: 'list-item',
        align: 'left',
        kind: 'text',
        text: {
          kind: 'body',
          inlineElements: [{ kind: 'text', text: { text: '相实的采集点有概率会被替换为' } }],
        },
      },
      'list-line-4': {
        id: 'list-line-4',
        parentId: 'list-item',
        align: 'left',
        kind: 'text',
        text: {
          kind: 'body',
          inlineElements: [
            {
              kind: 'entry',
              entry: { id: '43', showType: 'link-imgText', count: '0' },
            },
            { kind: 'text', text: { text: '的采集点。' } },
          ],
        },
      },
    }

    overviewDoc.blockIds = ['overview-list']
    overviewDoc.blockMap = blockMap

    const xml = wikiJsonToXml(payload).text
    const xmlDocument = new XmldomDOMParser().parseFromString(xml, 'application/xml')
    const list = xmlDocument.getElementsByTagName('ul')[0]
    if (!list) {
      throw new Error('Expected rendered XML to contain a list.')
    }

    const directElementChildren = Array.from(list.childNodes).filter(
      (node) => node.nodeType === 1
    ) as Array<typeof list>
    const items = directElementChildren.filter((node) => node.tagName === 'li')

    expect(directElementChildren.map((node) => node.tagName)).toEqual(['li', 'li', 'li', 'li'])
    expect(items.map((node) => node.textContent)).toEqual([
      '枢纽区',
      '待建设区极其容易获取。',
      '相实的采集点有概率会被替换为',
      '的采集点。',
    ])
    expect(items[1]!.getElementsByTagName('b')).toHaveLength(1)
    expect(items[1]!.getElementsByTagName('color')[0]!.getAttribute('value')).toBe('r_5')
    expect(items[3]!.getElementsByTagName('entry')[0]!.getAttribute('id')).toBe('43')
  })

  test('converts wiki JSON entries to XML as a batch', () => {
    const batch = wikiJsonToXmlBatch([
      { source: infoRootText, meta: { itemId: 'root' } },
      { source: infoItem, meta: { itemId: 'item' } },
    ])

    expect(batch.items).toHaveLength(2)
    expect(batch.items[0]?.meta).toEqual({ itemId: 'root' })
    expect(batch.items[1]?.meta).toEqual({ itemId: 'item' })
    expect(batch.items[0]?.text).toContain('<sklandDocument>')
    expect(batch.items[1]?.text).toContain('<sklandDocument>')
    expect(batch.warnings).toEqual(
      batch.items.flatMap((item, index) =>
        item.warnings.map((warning) => `entry ${index}: ${warning}`)
      )
    )
  })

  test('includes the batch index when a wiki JSON batch entry fails', () => {
    expect(() =>
      wikiJsonToXmlBatch([
        { source: infoRootText },
        { source: { itemId: 'bad' } },
      ])
    ).toThrow(/entry 1 failed/)
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

  test('parses submit JSON with commitMsg', () => {
    const submitPayload = {
      commitMsg: '测试编辑',
      item: infoItem,
    }
    const [document] = parseSubmitJson(submitPayload)

    expect(document.commitMsg).toBe('测试编辑')
    expect(document.name).toBe((infoItem as any).name)
    expect(document.itemId).toBe(String((infoItem as any).itemId))
  })

  test('submit JSON round-trips through XML preserving commitMsg', () => {
    const submitPayload = {
      commitMsg: '测试编辑',
      item: infoItem,
    }
    const xml = submitJsonToXml(submitPayload).text

    expect(xml).toContain('<sklandDocument>')
    expect(xml).toContain('<commitMsg>测试编辑</commitMsg>')

    const rendered = JSON.parse(xmlToSubmitJson(xml).text)
    expect(rendered.commitMsg).toBe('测试编辑')
    expect(rendered.item.brief.name).toBe((infoItem as any).brief.name)
  })

  test('commitMsg survives XML → InfoItem round-trip', () => {
    const submitPayload = {
      commitMsg: '编辑说明',
      item: infoItem,
    }
    const xml = submitJsonToXml(submitPayload).text
    const infoResult = xmlToWikiJson(xml)
    const rendered = JSON.parse(infoResult.text)

    expect(rendered.brief.name).toBe((infoItem as any).brief.name)
    expect(rendered).not.toHaveProperty('commitMsg')
  })

  test('submit JSON round-trips via wiki-json', () => {
    const submitPayload = {
      commitMsg: '测试',
      item: infoItem,
    }
    const wikiResult = submitJsonToWikiJson(submitPayload)
    const rendered = JSON.parse(wikiResult.text)
    expect(rendered).toHaveProperty('brief')
    expect(rendered).toHaveProperty('document')

    const backToSubmit = JSON.parse(wikiJsonToSubmitJson(wikiResult.text).text)
    expect(backToSubmit).toHaveProperty('commitMsg')
    expect(backToSubmit).toHaveProperty('item')
  })

  test('bare InfoItem is not mistaken for submit JSON', () => {
    expect(() => parseSubmitJson(infoItem)).toThrow(/must be an object containing `item`/)
  })

  test('converts XML entries to wiki JSON as a batch', () => {
    const batch = xmlToWikiJsonBatch([
      { source: sampleXmlText, meta: { itemId: 'sample' } },
      { source: '<sklandDocument><itemId>1</itemId><metainfo><name>n</name><cover showInDetail="true">https://example.com/c.png</cover><subTypes></subTypes></metainfo><description></description></sklandDocument>', meta: { itemId: 'minimal' } },
    ])

    expect(batch.items).toHaveLength(2)
    expect(batch.items[0]?.meta).toEqual({ itemId: 'sample' })
    expect(batch.items[1]?.meta).toEqual({ itemId: 'minimal' })
    expect(batch.items[0]?.text).toContain('"brief"')
    expect(batch.items[1]?.text).toContain('"brief"')
    expect(batch.warnings).toEqual(
      batch.items.flatMap((item, index) =>
        item.warnings.map((warning) => `entry ${index}: ${warning}`)
      )
    )
  })

  test('includes the batch index when an XML batch entry fails', () => {
    expect(() =>
      xmlToWikiJsonBatch([
        { source: sampleXmlText },
        { source: '<invalid>' },
      ])
    ).toThrow(/entry 1 failed/)
  })
})
