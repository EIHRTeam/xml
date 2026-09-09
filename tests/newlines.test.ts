import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  parseXml,
  renderXml,
  renderSubmitJson,
  submitJsonToXml,
  xmlToSubmitJson,
  type Block,
  type Inline,
} from '../src/index.js'
import { paragraph, textRun } from '../src/model.js'

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
  test.each(['甲\n乙', '甲\r\n乙\r丙', '\n甲\n\n乙\n', '<标签> & 值\n下一行'])(
    'round-trips %j as closed br elements in one block',
    (text) => {
      const model = document([paragraph([textRun(text)])])
      const xml = renderXml(model)
      expect(xml.match(/<br><\/br>/g)?.length).toBe(text.match(/\r\n|\r|\n/g)?.length)
      expect(xml).not.toContain('<br/>')
      expect(content(xml)).toEqual([paragraph([textRun(text.replace(/\r\n|\r/g, '\n'))])])
    },
  )

  test('preserves formatting around consecutive breaks and accepts self-closing input', () => {
    const inlines: Inline[] = [textRun('甲\n\n乙', { bold: true, italic: true, color: 'f_red' })]
    const xml = renderXml(document([paragraph(inlines, 'heading1')]))
    expect(xml).toContain('<b><i><color value="f_red">甲<br></br><br></br>乙</color></i></b>')
    expect(content(xml.replaceAll('<br></br>', '<br/>'))).toEqual([paragraph(inlines, 'heading1')])
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
    expect(content(renderXml(document(blocks)))).toEqual(blocks)
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
    expect(xml).toContain('【代号】莱万汀<br></br>【性别】女')
    expect(xml).toContain('非感染者。<br></br><br></br>【综合体检测试】')
    expect(JSON.parse(xmlToSubmitJson(xml, { referenceJson: original }).text)).toEqual(JSON.parse(original))
  })
})
