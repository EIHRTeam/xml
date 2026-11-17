import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  parseSubmitJson,
  parseWikiJson,
  parseXml,
  renderSubmitJson,
  renderWikiJson,
  renderXml,
  submitJsonToXml,
  xmlToSubmitJson,
  xmlToWikiJson,
  type AnnotationInline,
  type Block,
  type ComplexTableBlock,
  type Inline,
} from '../src/index.js'
import { inlinesToPlainText, iterImageBlocks, normalizeBlocks, paragraph, textRun } from '../src/model.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/2897-emoji-and-note.json', import.meta.url), 'utf8'))
const chatFixture = JSON.parse(readFileSync(new URL('./fixtures/2897-with-chat.json', import.meta.url), 'utf8'))
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

  test('extracts supported components from the chat fixture and rejects the full dialog widget', () => {
    expect(() => submitJsonToXml(chatFixture)).toThrow(/Unsupported widget type 'dialog'/)
    const supported = structuredClone(chatFixture)
    const descriptors = supported.item.document.chapterGroup[0].widgets
    const dialog = descriptors.find((entry: any) => supported.item.document.widgetCommonMap[entry.id].type === 'dialog')
    supported.item.document.chapterGroup[0].widgets = descriptors.filter((entry: any) => entry !== dialog)
    delete supported.item.document.widgetCommonMap[dialog.id]
    expect(parseXml(submitJsonToXml(supported).text)).toEqual(parseSubmitJson(supported)[0])
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
