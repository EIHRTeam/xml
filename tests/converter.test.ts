import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom'

import {
  parseSubmitJson,
  parseWikiJson,
  parseXml,
  renderSubmitJson,
  renderWikiJson,
  renderXml,
  submitJsonToWikiJson,
  submitJsonToXml,
  wikiJsonToSubmitJson,
  wikiJsonToXml,
  wikiJsonToXmlBatch,
  xmlToSubmitJson,
  xmlToWikiJson,
  xmlToWikiJsonBatch,
  XmlWikiConversionError,
  type AnnotationInline,
  type Block,
  type ComplexTableBlock,
  type Inline,
  type DocumentModel,
} from '../src/index.js'
import { inlinesToPlainText, iterImageBlocks, normalizeBlocks, paragraph, textRun } from '../src/model.js'

const fixturePath = resolve(import.meta.dirname, 'fixtures/item-info.response.sample.json')
const sampleXmlPath = resolve(import.meta.dirname, 'fixtures/sample.xml')
const infoRootText = readFileSync(fixturePath, 'utf8')
const sampleXmlText = readFileSync(sampleXmlPath, 'utf8')
const infoRoot = JSON.parse(infoRootText) as Record<string, unknown>
const infoItem = (infoRoot.data as { item: Record<string, unknown> }).item

function tabbedAudioItem() {
  const item = structuredClone(infoItem) as Record<string, any>
  item.document = {
    chapterGroup: [
      {
        title: '语音记录',
        widgets: [{ id: 'wTabbedAudio', title: '干员语音', size: 'large' }],
      },
    ],
    extraInfo: { illustration: '' },
    widgetCommonMap: {
      wTabbedAudio: {
        type: 'audio',
        tableList: [],
        tabList: [
          { tabId: 'voiceZh', title: '中文：测试声优', icon: '' },
          { tabId: 'voiceEn', title: '英语：Test Actor', icon: 'https://example.invalid/en.png' },
        ],
        tabDataMap: {
          voiceZh: {
            intro: null,
            content: '',
            audioList: [
              {
                title: '行动准备1',
                profile: '准备出发。',
                resourceUrl: 'https://example.invalid/zh-1.wav',
                id: 'old001',
              },
              {
                title: '行动准备2',
                profile: '交给我吧。',
                resourceUrl: 'https://example.invalid/zh-2.wav',
                id: 'old002',
              },
            ],
          },
          voiceEn: {
            intro: null,
            content: '',
            audioList: [
              {
                title: '行动准备1',
                profile: 'Ready to depart.',
                resourceUrl: 'https://example.invalid/en-1.wav',
                id: 'old003',
              },
              {
                title: '行动准备2',
                profile: 'Leave it to me.',
                resourceUrl: 'https://example.invalid/en-2.wav',
                id: 'old004',
              },
            ],
          },
        },
      },
    },
    documentMap: {},
  }
  return item
}

function audioChapterXml(content: string) {
  return `<sklandDocument>
    <itemId>audio-test</itemId>
    <metainfo>
      <name>Audio Test</name>
      <cover showInDetail="true">https://example.invalid/cover.png</cover>
      <subTypes></subTypes>
    </metainfo>
    <description></description>
    <chapters name="Audio">
      ${content}
    </chapters>
  </sklandDocument>`
}

function audioWidgetsFromItem(item: Record<string, any>) {
  const commonMap = item.document.widgetCommonMap as Record<string, any>
  return item.document.chapterGroup.flatMap((group: Record<string, any>) =>
    group.widgets
      .map((widget: Record<string, any>) => commonMap[widget.id])
      .filter((common: Record<string, any>) => common.type === 'audio')
  ) as Array<Record<string, any>>
}

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

  test('preserves multiple content blocks inside one wiki list item', () => {
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

    expect(directElementChildren.map((node) => node.tagName)).toEqual(['li'])
    expect(items[0]!.textContent!.trim().split(/\n\s*/)).toEqual([
      '枢纽区',
      '待建设区极其容易获取。',
      '相实的采集点有概率会被替换为',
      '的采集点。',
    ])
    expect(items[0]!.getElementsByTagName('b')).toHaveLength(1)
    expect(items[0]!.getElementsByTagName('color')[0]!.getAttribute('value')).toBe('r_5')
    expect(items[0]!.getElementsByTagName('entry')[0]!.getAttribute('id')).toBe('43')
    expect(parseXml(xml)).toEqual(parseWikiJson(payload))
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

  test('keeps an inline entry on the same line as preceding text in a table cell', () => {
    const sourceXml = `<?xml version="1.0" encoding="UTF-8"?>
<sklandDocument>
    <itemId>1</itemId>
    <metainfo>
        <name>n</name>
        <cover showInDetail="true">https://example.com/cover.png</cover>
        <subTypes></subTypes>
    </metainfo>
    <description></description>
    <chapters name="g">
        <chapter name="c" size="large">
            <table header="none" widths="580,580">
                <tr>
                    <td col="1">
                        <b>· </b>完成主线任务<entry type="link-img" count="0" id="1107"></entry>
                        <b>· </b>权限等阶≥30级
                    </td>
                    <td col="2">b</td>
                </tr>
            </table>
        </chapter>
    </chapters>
</sklandDocument>`
    const document = parseXml(sourceXml)

    const table = document.chapterGroups[0]!.chapters[0]!.content[0]!
    if (table.blockType !== 'complexTable') {
      throw new Error('Expected a complex table block.')
    }

    const cell = table.cells.find((entry) => entry.columnIndex === 0)
    if (!cell) {
      throw new Error('Expected a cell at column 0.')
    }

    // Two source lines → exactly two paragraphs; the entry must stay inline with
    // the text on its line instead of being pushed onto a line of its own.
    expect(cell.blocks).toHaveLength(2)

    const firstParagraph = cell.blocks[0]!
    if (firstParagraph.blockType !== 'paragraph') {
      throw new Error('Expected the first cell block to be a paragraph.')
    }
    expect(firstParagraph.inlines.map((inline) => inline.inlineType)).toEqual([
      'text',
      'text',
      'entry',
    ])

    const entryInline = firstParagraph.inlines[2]!
    if (entryInline.inlineType !== 'entry') {
      throw new Error('Expected the trailing inline to be an entry.')
    }
    expect(entryInline.targetId).toBe('1107')
    expect(entryInline.entryType).toBe('link-img')
    expect(entryInline.count).toBe('0')

    const secondParagraph = cell.blocks[1]!
    if (secondParagraph.blockType !== 'paragraph') {
      throw new Error('Expected the second cell block to be a paragraph.')
    }
    expect(secondParagraph.inlines.map((inline) => inline.inlineType)).toEqual(['text', 'text'])

    // The rendered XML must not break the entry onto its own line either.
    const renderedXml = wikiJsonToXml(xmlToWikiJson(sourceXml).text).text
    expect(renderedXml).toContain('完成主线任务<entry')
  })

  test('rejects wiki JSON without the public item shape', () => {
    expect(() => parseWikiJson({ itemId: '1' })).toThrow(XmlWikiConversionError)
  })

  test('round-trips tabbed audio through submit and wiki JSON targets', () => {
    const item = tabbedAudioItem()
    const submitPayload = { commitMsg: '多语言语音', item }
    const wikiDocument = parseWikiJson(item)
    const [submitDocument] = parseSubmitJson(submitPayload)
    const chapter = submitDocument.chapterGroups[0]!.chapters[0]!

    expect(chapter.chapterType).toBe('audio')
    expect(chapter.audios).toEqual([])
    expect(chapter.audioTabs).toEqual([
      {
        title: '中文：测试声优',
        icon: '',
        audios: [
          {
            title: '行动准备1',
            profile: '准备出发。',
            resourceUrl: 'https://example.invalid/zh-1.wav',
          },
          {
            title: '行动准备2',
            profile: '交给我吧。',
            resourceUrl: 'https://example.invalid/zh-2.wav',
          },
        ],
      },
      {
        title: '英语：Test Actor',
        icon: 'https://example.invalid/en.png',
        audios: [
          {
            title: '行动准备1',
            profile: 'Ready to depart.',
            resourceUrl: 'https://example.invalid/en-1.wav',
          },
          {
            title: '行动准备2',
            profile: 'Leave it to me.',
            resourceUrl: 'https://example.invalid/en-2.wav',
          },
        ],
      },
    ])

    const wikiXml = wikiJsonToXml(item).text
    const submitXml = submitJsonToXml(submitPayload).text
    expect(parseXml(wikiXml)).toEqual(wikiDocument)
    expect(parseXml(submitXml)).toEqual(submitDocument)
    expect(submitXml).toContain('<chapter size="large" name="干员语音" audio="true">')
    expect(submitXml).toContain('<tab name="中文：测试声优" icon="">')
    expect(submitXml).toContain(
      '<tab name="英语：Test Actor" icon="https://example.invalid/en.png">'
    )

    const renderedSubmit = JSON.parse(xmlToSubmitJson(submitXml).text) as Record<string, any>
    const submitAudio = audioWidgetsFromItem(renderedSubmit.item)[0]!
    expect(submitAudio.tabList.map(({ title, icon }: Record<string, string>) => ({ title, icon })))
      .toEqual([
        { title: '中文：测试声优', icon: '' },
        { title: '英语：Test Actor', icon: 'https://example.invalid/en.png' },
      ])
    const submitAudioLists = submitAudio.tabList.map(
      ({ tabId }: { tabId: string }) => submitAudio.tabDataMap[tabId].audioList
    ) as Array<Array<Record<string, string>>>
    expect(submitAudioLists.flat().every((audio) => /^[A-Za-z0-9]{6}$/.test(audio.id!))).toBe(true)
    expect(submitAudioLists.map((list) => list.map(({ id: _id, ...audio }) => audio))).toEqual(
      chapter.audioTabs!.map((tab) => tab.audios)
    )

    const renderedWiki = JSON.parse(xmlToWikiJson(submitXml).text) as Record<string, any>
    const wikiAudio = audioWidgetsFromItem(renderedWiki)[0]!
    const wikiAudioLists = wikiAudio.tabList.map(
      ({ tabId }: { tabId: string }) => wikiAudio.tabDataMap[tabId].audioList
    ) as Array<Array<Record<string, string>>>
    expect(wikiAudioLists.flat().every((audio) => !Object.hasOwn(audio, 'id'))).toBe(true)
    expect(wikiAudioLists).toEqual(chapter.audioTabs!.map((tab) => tab.audios))
  })

  test('emits audio ids only for flat submit JSON output', () => {
    const renderedSubmit = JSON.parse(xmlToSubmitJson(sampleXmlText).text) as Record<string, any>
    const submitAudioList = audioWidgetsFromItem(renderedSubmit.item)[0]!.tabDataMap.default.audioList
    expect(submitAudioList.every((audio: Record<string, string>) =>
      /^[A-Za-z0-9]{6}$/.test(audio.id!)
    )).toBe(true)

    const renderedWiki = JSON.parse(xmlToWikiJson(sampleXmlText).text) as Record<string, any>
    const wikiAudioList = audioWidgetsFromItem(renderedWiki)[0]!.tabDataMap.default.audioList
    expect(wikiAudioList.every((audio: Record<string, string>) => !Object.hasOwn(audio, 'id')))
      .toBe(true)
  })

  test('rejects missing tabbed audio data', () => {
    const item = tabbedAudioItem()
    delete item.document.widgetCommonMap.wTabbedAudio.tabDataMap.voiceEn

    expect(() => wikiJsonToXml(item)).toThrow(
      "Expected object at 'widgetCommonMap[wTabbedAudio].tabDataMap[voiceEn]'"
    )
  })

  test('rejects invalid mixed or incomplete tabbed audio XML', () => {
    expect(() => parseXml(audioChapterXml(`
      <chapter size="large" name="Mixed" audio="true">
        <audios></audios>
        <tab name="中文"><audios></audios></tab>
      </chapter>
    `))).toThrow(/cannot contain both direct <audios> and <tab>/)

    expect(() => parseXml(audioChapterXml(`
      <chapter size="large" name="Missing" audio="true">
        <tab name="中文"></tab>
      </chapter>
    `))).toThrow(/must contain exactly one <audios> element/)
  })

  test('rejects an audio DocumentModel with flat audios and audio tabs', () => {
    const document = parseXml(sampleXmlText)
    const chapter = document.chapterGroups
      .flatMap((group) => group.chapters)
      .find((candidate) => candidate.chapterType === 'audio')!
    chapter.audioTabs = [{ title: '中文', icon: null, audios: [...chapter.audios] }]

    expect(() => renderXml(document)).toThrow(/cannot contain both flat audios and audio tabs/)
    expect(() => renderSubmitJson(document)).toThrow(/cannot contain both flat audios and audio tabs/)
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

describe('external video (<video>) blocks', () => {
  const videoInfoItem = {
    itemId: '1272',
    brief: {
      name: '这里是标题',
      cover: 'https://example.com/cover.png',
      subTypeList: [],
      description: null,
    },
    document: {
      chapterGroup: [
        { title: '文字样式', widgets: [{ id: 'AaTliwoz', title: 'Bilibili', size: 'large' }] },
      ],
      extraInfo: { illustration: '' },
      widgetCommonMap: {
        AaTliwoz: { type: 'common', tabList: [], tabDataMap: { default: { content: 'zEZKFx3E' } } },
      },
      documentMap: {
        zEZKFx3E: {
          id: 'document-id',
          version: '1.0.0',
          blockIds: ['5952620', 'BV1c49DBjEzq'],
          blockMap: {
            '5952620': {
              kind: 'externalVideo',
              id: '5952620',
              parentId: 'document-id',
              externalVideo: {
                id: '5952620',
                kind: 'skland',
                elementId: 'mkstEJC1oI2I',
                type: 'external-video',
                children: [{ text: '' }],
              },
            },
            BV1c49DBjEzq: {
              kind: 'externalVideo',
              id: 'BV1c49DBjEzq',
              parentId: 'document-id',
              externalVideo: {
                id: 'BV1c49DBjEzq',
                kind: 'bilibili',
                elementId: 'hFGFwvR19Iie',
                type: 'external-video',
                children: [{ text: '' }],
              },
            },
          },
        },
      },
    },
  }

  const videoXml = `<?xml version="1.0" encoding="UTF-8"?>
<sklandDocument>
    <itemId>1272</itemId>
    <metainfo>
        <name>这里是标题</name>
        <cover showInDetail="true">https://example.com/cover.png</cover>
        <subTypes></subTypes>
    </metainfo>
    <description></description>
    <chapters name="文字样式">
        <chapter name="Bilibili" size="large">
            <video kind="skland" id="5952620"></video>
            <video kind="bilibili" id="BV1c49DBjEzq"></video>
        </chapter>
    </chapters>
</sklandDocument>`

  function chapterDocument(renderedItemText: string) {
    const rendered = JSON.parse(renderedItemText) as any
    const widgetId = Object.keys(rendered.document.widgetCommonMap)[0]!
    const documentId = rendered.document.widgetCommonMap[widgetId].tabDataMap.default.content
    return rendered.document.documentMap[documentId]
  }

  test('renders skland and bilibili videos as <video> tags', () => {
    const xml = wikiJsonToXml(videoInfoItem).text
    expect(xml).toContain('<video kind="skland" id="5952620"></video>')
    expect(xml).toContain('<video kind="bilibili" id="BV1c49DBjEzq"></video>')
  })

  test('parses <video> into externalVideo blocks', () => {
    const document = parseXml(videoXml)
    const videos = collectBlocks(document).flatMap((block) =>
      block.blockType === 'externalVideo' ? [{ kind: block.videoKind, id: block.videoId }] : []
    )
    expect(videos).toEqual([
      { kind: 'skland', id: '5952620' },
      { kind: 'bilibili', id: 'BV1c49DBjEzq' },
    ])
  })

  test('renders XML videos back to the external-video JSON shape', () => {
    const doc = chapterDocument(xmlToWikiJson(videoXml).text)
    expect(doc.blockIds).toEqual(['5952620', 'BV1c49DBjEzq'])

    const skland = doc.blockMap['5952620']
    expect(skland.kind).toBe('externalVideo')
    expect(skland.id).toBe('5952620')
    expect(skland.parentId).toBe('document-id')
    expect(skland.externalVideo.id).toBe('5952620')
    expect(skland.externalVideo.kind).toBe('skland')
    expect(skland.externalVideo.type).toBe('external-video')
    expect(skland.externalVideo.children).toEqual([{ text: '' }])
    expect(typeof skland.externalVideo.elementId).toBe('string')
    expect(skland.externalVideo.elementId.length).toBeGreaterThan(0)

    const bilibili = doc.blockMap['BV1c49DBjEzq']
    expect(bilibili.externalVideo.kind).toBe('bilibili')
    expect(bilibili.externalVideo.id).toBe('BV1c49DBjEzq')
  })

  test('round-trips videos through XML → JSON → XML', () => {
    const json = xmlToWikiJson(videoXml).text
    const xml = wikiJsonToXml(json).text
    expect(xml).toContain('<video kind="skland" id="5952620"></video>')
    expect(xml).toContain('<video kind="bilibili" id="BV1c49DBjEzq"></video>')

    const videos = collectBlocks(parseXml(xml)).flatMap((block) =>
      block.blockType === 'externalVideo' ? [{ kind: block.videoKind, id: block.videoId }] : []
    )
    expect(videos).toEqual([
      { kind: 'skland', id: '5952620' },
      { kind: 'bilibili', id: 'BV1c49DBjEzq' },
    ])
  })

  test('round-trips videos through JSON → XML → JSON', () => {
    const xml = wikiJsonToXml(videoInfoItem).text
    const doc = chapterDocument(xmlToWikiJson(xml).text)
    expect(doc.blockMap['5952620'].externalVideo.kind).toBe('skland')
    expect(doc.blockMap['BV1c49DBjEzq'].externalVideo.kind).toBe('bilibili')
  })

  test('rejects an unsupported video kind from XML', () => {
    const xml = videoXml.replace('kind="skland"', 'kind="youtube"')
    expect(() => parseXml(xml)).toThrow(/Unsupported external video kind/)
  })

  test('requires kind and id attributes on <video>', () => {
    expect(() => parseXml(videoXml.replace('kind="skland" ', ''))).toThrow(
      /must include a kind attribute/
    )
    expect(() => parseXml(videoXml.replace(' id="5952620"', ''))).toThrow(
      /must include an id attribute/
    )
  })

  test('rejects an unsupported video kind from wiki JSON', () => {
    const badItem = structuredClone(videoInfoItem) as any
    badItem.document.documentMap.zEZKFx3E.blockMap['5952620'].externalVideo.kind = 'youtube'
    expect(() => wikiJsonToXml(badItem)).toThrow(/Unsupported external video kind/)
  })
})

describe('inline components', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/2897-emoji-and-note.json', import.meta.url), 'utf8'))
  const emoji: Inline = { inlineType: 'emoji', id: 'custom<&"icon' }
  const note = (content: Block[] = [], title: Inline[] = []): AnnotationInline => ({
    inlineType: 'annotation', title, content,
  })
  function model(blocks: Block[]) {
    const document = parseSubmitJson(fixture)[0]
    document.description = blocks
    document.chapterGroups = []
    return document
  }
  function chapterModel(blocks: Block[]) {
    const document = model([])
    document.chapterGroups = [{ title: 'Group', chapters: [{
      title: 'Chapter', size: 'large', chapterType: 'common', content: blocks,
      tabs: [], audios: [], tableRows: [],
    }] }]
    return document
  }
  function xml(content: string) {
    return renderXml(model([paragraph([textRun('PLACEHOLDER')])])).replace('PLACEHOLDER', content)
  }
  function table(blocks: Block[]): ComplexTableBlock {
    return {
      blockType: 'complexTable', headerMode: 'none', columnWidths: [100],
      rowCount: 1, columnCount: 1,
      cells: [{ rowIndex: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, blocks }],
    }
  }
  function descriptionPayload(blocks: Block[]) {
    return JSON.parse(renderSubmitJson(model(blocks)))
  }
  function annotationRefs(document: any) {
    return Object.entries(document.blockMap).flatMap(([owner, block]: [string, any]) =>
      (block.text?.inlineElements ?? []).filter((entry: any) => entry.kind === 'annotation')
        .map((entry: any) => ({ owner, annotation: entry.annotation })),
    )
  }
  function assertAnnotationReferences(item: any) {
    let count = 0
    for (const document of [item.brief.description, ...Object.values(item.document.documentMap)] as any[]) {
      for (const { owner, annotation } of annotationRefs(document)) {
        count++
        for (const id of annotation.childIds) {
          expect(document.blockMap[id]?.parentId).toBe(owner)
          expect(document.blockIds).not.toContain(id)
        }
      }
    }
    expect(count).toBe(3)
  }

  describe('emoji and annotation conversion', () => {
    test('round-trips all three locations in the actual submit fixture', () => {
      const original = parseSubmitJson(fixture)[0]
      const outputXml = submitJsonToXml(fixture).text
      const reparsed = parseXml(outputXml)
      expect(reparsed).toEqual(original)
      const output = JSON.parse(xmlToSubmitJson(outputXml).text)
      expect(parseSubmitJson(output)[0]).toEqual(original)
      assertAnnotationReferences(output.item)
      const icons = [...outputXml.matchAll(/<emoji id="([^"]+)"/g)].map((match) => match[1])
      expect(new Set(icons).size).toBe(70)
      expect(icons.length).toBe(222)
      expect(output.commitMsg).toBe(fixture.commitMsg)
    })

    test('round-trips bare Wiki items and InfoRoot envelopes', () => {
      for (const source of [fixture.item, { code: 0, data: { item: fixture.item } }]) {
        const original = parseWikiJson(source)
        const outputXml = renderXml(original)
        expect(parseXml(outputXml)).toEqual(original)
        const options = { wrapInfoRoot: Boolean(source.data) }
        const wiki = xmlToWikiJson(outputXml, options).text
        expect(parseWikiJson(wiki)).toEqual(original)
        const payload = JSON.parse(wiki)
        assertAnnotationReferences(payload.data?.item ?? payload)
        expect(renderWikiJson(parseXml(outputXml), options)).toBe(wiki)
      }
    })

    test('preserves atomic components, empty annotations, multiple notes and outer paragraph boundaries', () => {
      const blocks = [
        paragraph([emoji]),
        paragraph([note()]),
        paragraph([textRun('before '), note([paragraph([textRun('line 1\n\nline 3')])], [textRun('title '), emoji]), textRun(' after\nnext '), note([], [textRun('second')]), emoji]),
      ]
      const document = model(blocks)
      const outputXml = renderXml(document)
      expect(outputXml).toContain('<emoji id="custom&lt;&amp;&quot;icon"></emoji>')
      expect(parseXml(outputXml).description).toEqual(normalizeBlocks(blocks))
      expect(parseSubmitJson(renderSubmitJson(document))[0].description).toEqual(normalizeBlocks(blocks))
      expect(parseXml(xml('<emoji id="any-new-id"/>')).description).toEqual([paragraph([{ inlineType: 'emoji', id: 'any-new-id' }])])
      expect(parseXml(xml('<emoji id="any-new-id"> \n </emoji>')).description).toHaveLength(1)
    })

    test('handles annotations in headings, formatted text, lists, quotes and table cells', () => {
      const annotation = note([paragraph([textRun('detail')])], [textRun('label ', { bold: true }), emoji])
      const blocks: Block[] = [
        paragraph([textRun('before '), emoji, textRun(' after'), annotation], 'heading1'),
        { blockType: 'quote', children: [paragraph([annotation])] },
        { blockType: 'list', ordered: false, items: [{ blocks: [paragraph([emoji, annotation])] }] },
        table([paragraph([annotation])]),
      ]
      const document = chapterModel(blocks)
      expect(parseXml(renderXml(document))).toEqual({ ...document, chapterGroups: [{ ...document.chapterGroups[0]!, chapters: [{ ...document.chapterGroups[0]!.chapters[0]!, content: normalizeBlocks(blocks) }] }] })
      expect(parseSubmitJson(renderSubmitJson(document))[0]).toEqual(document)
    })

    test('keeps title text in plain-text extraction and traverses detail images', () => {
      const image: Block = { blockType: 'image', url: 'https://example.test/a.png', width: '100', height: '20', size: '1', imageId: 'a', imageFormat: 'png', description: '' }
      const annotation = note([image], [textRun('label'), emoji])
      expect(inlinesToPlainText([emoji, annotation])).toBe('label')
      expect([...iterImageBlocks([paragraph([annotation])])]).toEqual([image])
      expect(() => renderXml(model([table([paragraph([note([{ ...image, width: 'invalid' }])])])]))).toThrow(/not numeric/)
    })

    test('normalizes titles without mutating the caller or changing repeated output', () => {
      const document = model([paragraph([note([], [textRun('a '), textRun('b'), emoji, textRun('\nnext', { bold: true })])])])
      const before = structuredClone(document)
      const outputXml = renderXml(document)
      const outputJson = renderSubmitJson(document)
      expect(document).toEqual(before)
      expect(renderXml(document)).toBe(outputXml)
      expect(renderSubmitJson(document)).toBe(outputJson)
      expect(parseXml(outputXml)).toEqual(parseSubmitJson(outputJson)[0])
    })

    test('round-trips details containing explicit-width tables without a chapter size', () => {
      const document = model([paragraph([note([table([paragraph([emoji])])])])])
      const outputXml = renderXml(document)
      expect(parseXml(outputXml)).toEqual(document)
      expect(parseSubmitJson(renderSubmitJson(document))[0]).toEqual(document)
      expect(() => parseXml(outputXml.replace(' widths="100"', ''))).toThrow(/require a chapter size/)
    })

    test('derives annotation table widths from the enclosing chapter', () => {
      const outputXml = renderXml(chapterModel([paragraph([note([table([paragraph([emoji])])])])]))
      const parsed = parseXml(outputXml.replace(' widths="100"', ''))
      const owner = parsed.chapterGroups[0]!.chapters[0]!.content[0] as any
      expect(owner.inlines[0].content[0].columnWidths).toEqual([1160])
    })
  })

  describe('inline component validation', () => {
    test.each(['h1', 'align', 'b'])(
      'collapses formatting whitespace around components inside <%s>', (tag) => {
        const markup = `<${tag}>before  \n  <b>bold  \n text </b><emoji id="x"/>  \n  after</${tag}>`
        const document = parseXml(xml(markup))
        expect(document.description).toHaveLength(1)
        const block = document.description[0] as any
        const expected = tag === 'b' ? [
          textRun('before bold text ', { bold: true }),
          { inlineType: 'emoji', id: 'x' },
          textRun(' after', { bold: true }),
        ] : [
          textRun('before '),
          textRun('bold text ', { bold: true }),
          { inlineType: 'emoji', id: 'x' },
          textRun(' after'),
        ]
        expect(block.inlines).toEqual(expected)
        expect(block.kind).toBe(tag === 'h1' ? 'heading1' : 'body')
      },
    )

    test('collapses formatting newlines around an annotation while preserving explicit breaks', () => {
      const markup = '<h1>before  \n <annotation><title>label</title><content>detail</content></annotation>  \n after<br/>next</h1>'
      expect(parseXml(xml(markup)).description).toEqual([
        paragraph([textRun('before '), note([paragraph([textRun('detail')])], [textRun('label')]), textRun(' after')], 'heading1'),
        paragraph([textRun('next')], 'heading1'),
      ])
    })

    test('rejects cyclic title arrays and annotation components with conversion errors', () => {
      const self = note()
      self.title.push(self)
      const mutual = note()
      const other = note([], [mutual])
      mutual.title.push(other)
      const sharedTitle: Inline[] = []
      const shared = note([], sharedTitle)
      sharedTitle.push(shared)
      for (const title of [self, mutual, shared]) {
        const document = model([paragraph([title])])
        for (const render of [renderXml, renderSubmitJson, renderWikiJson]) {
          expect(() => render(document)).toThrow(XmlWikiConversionError)
        }
      }
      const sameArray = model([paragraph(sharedTitle)])
      for (const render of [renderXml, renderSubmitJson, renderWikiJson]) {
        expect(() => render(sameArray)).toThrow(/Cyclic inline reference/)
      }
      const repeated = note([], [textRun('valid')])
      const document = model([paragraph([repeated, repeated])])
      expect(parseXml(renderXml(document)).description).toEqual(document.description)
    })

    test.each([
      '<emoji/>', '<emoji id=""/>', '<emoji id=" "/>',
      '<emoji id="x">text</emoji>', '<emoji id="x"><b/></emoji>',
      '<emoji id="x"><![CDATA[text]]></emoji>', '<emoji id="x" text="lost"/>',
    ])('rejects invalid emoji XML %s', (content) => {
      expect(() => parseXml(xml(content))).toThrow(/Emoji|emoji/)
    })

    test.each([
      '<annotation/>',
      '<annotation><title/></annotation>',
      '<annotation><content/></annotation>',
      '<annotation><title/><title/><content/></annotation>',
      '<annotation><title/><content/><content/></annotation>',
      '<annotation><title/><content/><unknown/></annotation>',
      '<annotation>lost<title/><content/></annotation>',
      '<annotation><title><quote>block</quote></title><content/></annotation>',
    ])('rejects invalid annotation XML %s', (content) => {
      expect(() => parseXml(xml(content))).toThrow(/annotation|inline tag/)
    })

    test.each([
      '<annotation><title><annotation><title/><content/></annotation></title><content/></annotation>',
      '<annotation><title/><content><quote><annotation><title/><content/></annotation></quote></content></annotation>',
      '<annotation><title><a href="x"><annotation><title/><content/></annotation></a></title><content/></annotation>',
    ])('rejects nested annotations throughout XML %s', (content) => {
      expect(() => parseXml(xml(content))).toThrow(/Nested annotations/)
    })

    test.each(['a', 'pron'])('rejects components inside text-only <%s> containers', (tag) => {
      expect(() => parseXml(xml(`<${tag}><emoji id="x"/></${tag}>`))).toThrow(/text-only/)
      expect(() => parseXml(xml(`<${tag}><annotation><title/><content/></annotation></${tag}>`))).toThrow(/text-only/)
    })

    test('does not inherit outer formatting into the annotation title or details', () => {
      const annotation = note([paragraph([textRun('detail')])], [textRun('title')])
      const markup = '<b><annotation><title>title</title><content>detail</content></annotation></b>'
      expect(parseXml(xml(markup)).description).toEqual([paragraph([annotation])])
    })

    test('validates icon JSON and accepts missing empty text and arbitrary IDs', () => {
      for (const change of [
        (icon: any) => { delete icon.id },
        (icon: any) => { icon.id = '' },
        (icon: any) => { icon.text = ' ' },
        (icon: any) => { icon.text = 1 },
        (icon: any) => { icon.text = null },
        (icon: any) => { icon.text = undefined },
      ]) {
        const payload = descriptionPayload([paragraph([emoji])])
        const document = payload.item.brief.description
        change(document.blockMap[document.blockIds[0]].text.inlineElements[0].gameIcon)
        expect(() => parseSubmitJson(payload)).toThrow(/id|gameIcon.text/)
      }
      const payload = descriptionPayload([paragraph([emoji])])
      const document = payload.item.brief.description
      delete document.blockMap[document.blockIds[0]].text.inlineElements[0].gameIcon.text
      expect(parseSubmitJson(payload)[0].description).toEqual([paragraph([emoji])])
    })

    test('rejects missing and malformed annotation references and payloads', () => {
      for (const change of [
        (annotation: any) => { annotation.childIds = ['missing'] },
        (annotation: any) => { annotation.childIds = [1] },
        (annotation: any) => { delete annotation.childIds },
        (annotation: any) => { delete annotation.inlineElements },
      ]) {
        const payload = descriptionPayload([paragraph([note()])])
        change(annotationRefs(payload.item.brief.description)[0]!.annotation)
        expect(() => parseSubmitJson(payload)).toThrow(/Expected/)
      }
    })

    test('rejects cycles through annotation blocks before overflowing the stack', () => {
      const payload = descriptionPayload([paragraph([note([paragraph([textRun('detail')])])])])
      const document = payload.item.brief.description
      const { owner, annotation } = annotationRefs(document)[0]!
      const id = annotation.childIds[0]
      document.blockMap[id] = { id, kind: 'quote', quote: { childIds: [owner] } }
      expect(() => parseSubmitJson(payload)).toThrow(/Cyclic JSON block reference/)

      const root = paragraph([note()])
      const inline = root.inlines[0] as AnnotationInline
      inline.content.push(root)
      expect(() => renderXml(model([root]))).toThrow(/Cyclic block reference/)
      expect(() => renderSubmitJson(model([root]))).toThrow(/Cyclic block reference/)
    })

    test('rejects annotations nested through JSON titles and block descendants', () => {
      for (const location of ['title', 'content']) {
        const payload = descriptionPayload([paragraph([note([paragraph([textRun('detail')])])])])
        const document = payload.item.brief.description
        const { annotation } = annotationRefs(document)[0]!
        const nested = { kind: 'annotation', annotation: { inlineElements: [], childIds: [] } }
        if (location === 'title') annotation.inlineElements.push(nested)
        else document.blockMap[annotation.childIds[0]].text.inlineElements.push(nested)
        expect(() => parseSubmitJson(payload)).toThrow(/Nested annotations/)
      }
    })

    test('validates directly constructed components in every document location', () => {
      for (const invalid of [
        { inlineType: 'emoji', id: '' } as Inline,
        note([], [note()]),
        note([{ blockType: 'quote', children: [paragraph([note()])] }]),
      ]) {
        const locations = [model([paragraph([invalid])]), chapterModel([paragraph([invalid])])]
        const withIntro = chapterModel([])
        withIntro.chapterGroups[0]!.chapters[0]!.tabs = [{ title: '', icon: '', content: [], intro: {
          name: '', introType: '', imageUrl: '', description: [invalid],
        } }]
        locations.push(withIntro)
        for (const document of locations) {
          expect(() => renderXml(document)).toThrow(/nonempty id|Nested annotations/)
          expect(() => renderSubmitJson(document)).toThrow(/nonempty id|Nested annotations/)
        }
      }
    })

    test('inherits table restrictions through annotation details for XML, JSON and model inputs', () => {
      const inner = table([paragraph([textRun('cell')])])
      const document = chapterModel([paragraph([note([inner])])])
      expect(parseXml(renderXml(document))).toEqual(document)

      const invalid = chapterModel([table([paragraph([note([inner])])])])
      expect(() => renderXml(invalid)).toThrow(/Nested tables/)
      expect(() => renderSubmitJson(invalid)).toThrow(/Nested tables/)

      const payload = descriptionPayload([table([paragraph([note([paragraph([textRun('detail')])])])])])
      const description = payload.item.brief.description
      const { annotation } = annotationRefs(description)[0]!
      const detail = annotation.childIds[0]
      description.blockMap[detail] = { id: detail, kind: 'table', table: {} }
      expect(() => parseSubmitJson(payload)).toThrow(/Nested tables/)

      const markup = '<table widths="100"><tr><td><annotation><title/><content><quote><table widths="100"><tr><td>x</td></tr></table></quote></content></annotation></td></tr></table>'
      const chapterXml = renderXml(chapterModel([paragraph([textRun('PLACEHOLDER')])]))
      expect(() => parseXml(chapterXml.replace('PLACEHOLDER', markup))).toThrow(/Nested tables/)
    })
  })

  describe('annotation detail identities', () => {
    test('accepts the fixture detail parent IDs and repairs them during rendering', () => {
      const original = structuredClone(fixture)
      const documents = [fixture.item.brief.description, ...Object.values(fixture.item.document.documentMap)] as any[]
      for (const document of documents) {
        const { owner, annotation } = annotationRefs(document)[0]!
        for (const id of annotation.childIds) {
          expect(document.blockMap[id].parentId).not.toBe(owner)
        }
      }
      const output = JSON.parse(xmlToSubmitJson(submitJsonToXml(fixture).text, { referenceJson: fixture }).text)
      assertAnnotationReferences(output.item)
      expect(fixture).toEqual(original)
    })

    test('generates detail IDs without a reference and reuses them when a reference is provided', () => {
      const original = annotationRefs(fixture.item.brief.description)[0]!.annotation.childIds
      const sourceXml = submitJsonToXml(fixture).text
      const generated = JSON.parse(xmlToSubmitJson(sourceXml).text)
      const reused = JSON.parse(xmlToSubmitJson(sourceXml, { referenceJson: fixture }).text)
      expect(annotationRefs(generated.item.brief.description)[0]!.annotation.childIds).not.toEqual(original)
      expect(annotationRefs(reused.item.brief.description)[0]!.annotation.childIds).toEqual(original)
    })

    test('preserves references and identities across the actual fixture including image intros', () => {
      const outputXml = submitJsonToXml(fixture).text
      const output = JSON.parse(xmlToSubmitJson(outputXml, { referenceJson: fixture }).text)
      const originalDocuments = [fixture.item.brief.description, ...Object.values(fixture.item.document.documentMap)] as any[]
      const outputDocuments = [output.item.brief.description, ...Object.values(output.item.document.documentMap)] as any[]
      expect(Object.keys(output.item.document.documentMap).sort()).toEqual(Object.keys(fixture.item.document.documentMap).sort())
      for (let i = 0; i < originalDocuments.length; i++) {
        expect(annotationRefs(outputDocuments[i])[0]!.annotation.childIds).toEqual(annotationRefs(originalDocuments[i])[0]!.annotation.childIds)
      }
      assertAnnotationReferences(output.item)
    })

    test('reuses detail IDs after title and detail edits and allocates new blocks without collisions', () => {
      const source = descriptionPayload([paragraph([
        note([paragraph([textRun('first')]), paragraph([textRun('second')])], [textRun('label')]),
        note([paragraph([textRun('other')])], [textRun('second note')]),
      ])])
      const original = source.item.brief.description
      const originalRefs = annotationRefs(original)
      const document = parseXml(submitJsonToXml(source).text)
      const first = (document.description[0] as any).inlines[0] as AnnotationInline
      first.title = [textRun('renamed')]
      first.content[0] = paragraph([textRun('first edited')])
      first.content.push(paragraph([textRun('new')]))
      const output = JSON.parse(xmlToSubmitJson(renderXml(document), { referenceJson: source }).text)
      const next = output.item.brief.description
      const refs = annotationRefs(next)
      expect(refs[0]!.owner).toBe(originalRefs[0]!.owner)
      expect(refs[0]!.annotation.childIds.slice(0, 2)).toEqual(originalRefs[0]!.annotation.childIds)
      expect(refs[1]!.annotation.childIds).toEqual(originalRefs[1]!.annotation.childIds)
      const added = refs[0]!.annotation.childIds[2]
      expect(original.blockMap[added]).toBeUndefined()
      expect(next.blockMap[added].parentId).toBe(refs[0]!.owner)
      const ids = Object.keys(next.blockMap)
      expect(ids.length).toBe(5)
      expect(refs.flatMap(({ annotation }) => annotation.childIds).every((id: string) => !next.blockIds.includes(id))).toBe(true)
      expect(xmlToSubmitJson(renderXml(document), { referenceJson: source }).text).toBe(JSON.stringify(output, null, 4) + '\n')
    })

    test('keeps table, list and video identities inside annotation details', () => {
      const document = chapterModel([paragraph([note([
        table([paragraph([textRun('cell')])]),
        { blockType: 'list', ordered: true, items: [{ blocks: [paragraph([emoji])] }] },
        { blockType: 'externalVideo', videoKind: 'bilibili', videoId: 'BV-example' },
      ], [textRun('label')])])])
      const source = JSON.parse(renderSubmitJson(document))
      expect(JSON.parse(xmlToSubmitJson(submitJsonToXml(source).text, { referenceJson: source }).text)).toEqual(source)
    })
  })
})
