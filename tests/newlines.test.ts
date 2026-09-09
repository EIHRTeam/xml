import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  parseXml,
  parseSubmitJson,
  xmlToWikiJson,
  renderXml,
  renderSubmitJson,
  submitJsonToXml,
  xmlToSubmitJson,
  type Block,
  type Inline,
} from '../src/index.js'
import { normalizeBlocks, paragraph, textRun } from '../src/model.js'

const sample = readFileSync(new URL('./fixtures/sample.xml', import.meta.url), 'utf8')
const record = JSON.parse(readFileSync(new URL('./fixtures/laevat-basic-record.json', import.meta.url), 'utf8')) as {
  title: string
  content: string
}
function document(blocks: Block[]) {
  const model = parseXml(sample)
  model.description = []
  model.chapterGroups = [
    {
      title: '资料',
      chapters: [
        {
          title: '档案',
          size: 'middle',
          chapterType: 'common',
          content: blocks,
          tabs: [],
          audios: [],
          tableRows: [],
        },
      ],
    },
  ]
  return model
}
const content = (xml: string) => parseXml(xml).chapterGroups[0]!.chapters[0]!.content

describe('explicit inline line breaks', () => {
  test.each(['甲 \n 乙', '甲\n乙', '甲\r\n乙\r丙', '\n甲\n\n乙\n', '<标签> & 值\n下一行'])(
    'round-trips %j as paragraph boundaries',
    (text) => {
      const model = document([paragraph([textRun(text)])])
      const xml = renderXml(model)
      expect(xml).not.toContain('<br></br>')
      expect(xml).not.toContain('<br/>')
      expect(content(xml)).toEqual(text.replace(/\r\n|\r/g, '\n').replace(/^\n+|\n+$/g, '').split('\n').map(line => paragraph(line.trim() ? [textRun(line.trim())] : [])))
    },
  )

  test('preserves formatting around consecutive breaks and accepts self-closing input', () => {
    const inlines: Inline[] = [textRun('甲\n\n乙', { bold: true, italic: true, color: 'f_red' })]
    const xml = renderXml(document([paragraph(inlines, 'heading1')]))
    const expected = [paragraph([textRun('甲', { bold: true, italic: true, color: 'f_red' })], 'heading1'), paragraph(), paragraph([textRun('乙', { bold: true, italic: true, color: 'f_red' })], 'heading1')]
    expect(content(xml)).toEqual(expected)
    const base = renderXml(document([paragraph([textRun('PLACEHOLDER')])]))
    for (const br of ['<br></br>', '<br/>']) {
      expect(content(base.replace('PLACEHOLDER', `<h1><b><i><color value="f_red">甲${br}${br}乙</color></i></b></h1>`))).toEqual(expected)
    }
  })

  test('supports breaks in links, pronunciations, lists, quotes and table cells', () => {
    const inlines: Inline[] = [
      { inlineType: 'link', href: 'https://example.test', text: '甲\n乙' },
      { inlineType: 'pronunciation', content: '丙\n丁' },
    ]
    const blocks: Block[] = [
      { blockType: 'quote', children: [paragraph(inlines)] },
      { blockType: 'list', ordered: false, items: [{ blocks: [paragraph([textRun('一\n二')])] }] },
      {
        blockType: 'complexTable',
        headerMode: 'none',
        columnWidths: [100],
        rowCount: 1,
        columnCount: 1,
        cells: [{ rowIndex: 0, columnIndex: 0, rowSpan: 1, colSpan: 1, blocks: [paragraph([textRun('上\n下')])] }],
      },
    ]
    expect(content(renderXml(document(blocks)))).toEqual(normalizeBlocks(blocks))
  })

  test('retains legacy paragraph separators, literal escaped markup and rejects nonempty br', () => {
    const model = document([paragraph([textRun('甲')]), paragraph([textRun('乙')])])
    const xml = renderXml(model)
    expect(content(xml)).toHaveLength(2)
    expect(renderXml(document([paragraph([textRun('<br></br>')])]))).toContain('&lt;br&gt;&lt;/br&gt;')
    expect(() => parseXml(xml.replace('甲', '甲<br>lost text</br>'))).toThrow(/must not contain content/)
  })

  test('preserves audio profile newlines, including empty lines', () => {
    const model = document([])
    const chapter = model.chapterGroups[0]!.chapters[0]!
    chapter.chapterType = 'audio'
    chapter.audios = [{ title: 'Audio', profile: '\n甲\n\n乙\n', resourceUrl: 'https://example.test/a.wav' }]
    const xml = renderXml(model)
    expect(xml).toContain('<br></br>甲<br></br><br></br>乙<br></br>')
    expect(parseXml(xml).chapterGroups[0]!.chapters[0]!.audios).toEqual(chapter.audios)
  })

  test('keeps Laevat archive text and its block identity through JSON/XML/JSON', () => {
    const original = renderSubmitJson(document([paragraph([textRun(record.content)])]))
    const xml = submitJsonToXml(original).text
    expect(xml).toMatch(/【代号】莱万汀\n +【性别】女/)
    expect(xml).toMatch(/非感染者。\n\n +【综合体检测试】/)
    expect(JSON.parse(xmlToSubmitJson(xml, { referenceJson: original }).text)).toEqual(JSON.parse(original))
  })
})

function textBlocks(json: string): Array<{ kind: string; align: string; text?: { kind: string; inlineElements: Array<{ text?: { text: string } }> } }> {
  const payload = JSON.parse(json)
  const doc = Object.values(payload.item.document.documentMap)[0] as { blockIds: string[]; blockMap: Record<string, never> }
  return doc.blockIds.map(id => doc.blockMap[id]!)
}

test('Laevat br input yields 15 text blocks between horizontal lines and stable IDs', () => {
  const base = renderXml(document([paragraph([textRun('PLACEHOLDER')])]))
  const xml = base.replace('PLACEHOLDER', `<line></line>${record.content.replaceAll('\n', '<br></br>')}<line></line>`)
  const first = xmlToSubmitJson(xml).text
  const blocks = textBlocks(first)
  expect(blocks).toHaveLength(17)
  expect(blocks[0]!.kind).toBe('horizontalLine')
  expect(blocks[16]!.kind).toBe('horizontalLine')
  expect(blocks.filter(b => b.text?.inlineElements.length === 0)).toHaveLength(2)
  for (const block of blocks.filter(b => b.kind === 'text')) {
    expect(block.text!.kind).toBe('body')
    expect(block.align).toBe('left')
    for (const inline of block.text!.inlineElements) expect(inline.text?.text).not.toContain('\n')
  }
  expect(xmlToSubmitJson(xml).text).toBe(first)
  expect(xmlToSubmitJson(xml, { referenceJson: first }).text).toBe(first)
  expect(xmlToSubmitJson(submitJsonToXml(first).text, { referenceJson: first }).text).toBe(first)
})

test('preserves every interior empty line and trims boundary breaks', () => {
  const base = renderXml(document([paragraph([textRun('PLACEHOLDER')])]))
  const xml = base.replace('PLACEHOLDER', '<br/><br/>甲<br/><br/><br/>乙<br/><br/>')
  const expected = [paragraph([textRun('甲')]), paragraph(), paragraph(), paragraph([textRun('乙')])]
  expect(content(xml)).toEqual(expected)
  expect(content(renderXml(document(expected)))).toEqual(expected)
})

test('splits XML links and pronunciations inside every nested container', () => {
  const base = renderXml(document([paragraph([textRun('PLACEHOLDER')])]))
  const line = '<a href="https://example.test">甲<br/>乙</a><pron>丙<br/>丁</pron>'
  const expected = [
    paragraph([{ inlineType: 'link', href: 'https://example.test', text: '甲' }]),
    paragraph([{ inlineType: 'link', href: 'https://example.test', text: '乙' }, { inlineType: 'pronunciation', content: '丙' }]),
    paragraph([{ inlineType: 'pronunciation', content: '丁' }]),
  ]
  for (const wrapper of [line, `<quote>${line}</quote>`, `<ul><li>${line}</li></ul>`, `<table><tr><td>${line}</td></tr></table>`]) {
    const xml = base.replace('PLACEHOLDER', wrapper)
    const blocks = content(xml)
    const first = blocks[0]!
    const paragraphs = first.blockType === 'quote' ? first.children : first.blockType === 'list' ? first.items[0]!.blocks : first.blockType === 'complexTable' ? first.cells[0]!.blocks : blocks
    expect(paragraphs).toEqual(expected)
    const json = xmlToSubmitJson(xml).text
    expect(parseSubmitJson(json)[0].chapterGroups[0]!.chapters[0]!.content).toEqual(blocks)
    expect(xmlToSubmitJson(submitJsonToXml(json).text, { referenceJson: json }).text).toBe(json)
    expect(xmlToWikiJson(xml).text).not.toContain('甲\\n乙')
  }
})

test('retains first line reference identity and allocates other lines reproducibly', () => {
  const original = JSON.parse(renderSubmitJson(document([paragraph([textRun('first')])])))
  const doc = Object.values(original.item.document.documentMap)[0] as { blockIds: string[]; blockMap: Record<string, any> }
  const oldId = doc.blockIds[0]!
  doc.blockMap[oldId].text.inlineElements[0].text.text = 'first\nsecond'
  const xml = submitJsonToXml(original).text
  const first = xmlToSubmitJson(xml, { referenceJson: original }).text
  const output = JSON.parse(first)
  const nextDoc = Object.values(output.item.document.documentMap)[0] as { blockIds: string[] }
  expect(nextDoc.blockIds[0]).toBe(oldId)
  expect(nextDoc.blockIds).toHaveLength(2)
  expect(nextDoc.blockIds[1]).not.toBe(oldId)
  expect(xmlToSubmitJson(xml, { referenceJson: original }).text).toBe(first)
})

test('preserves formatted imgIntro description newline semantics', () => {
  const model = document([])
  model.chapterGroups[0]!.chapters[0]!.tabs = [{ title: 'Intro', icon: null, content: [], intro: {
    name: 'Image', introType: 'image', imageUrl: 'https://example.test/image.png',
    description: [textRun('甲 \n\n乙', { bold: true })],
  } }]
  const json = renderSubmitJson(model)
  expect(parseSubmitJson(json)[0].chapterGroups[0]!.chapters[0]!.tabs[0]!.intro!.description).toEqual([textRun('甲', { bold: true }), textRun('\n\n'), textRun('乙', { bold: true })])
  expect(xmlToSubmitJson(renderXml(model), { referenceJson: json }).text).toBe(json)
})
