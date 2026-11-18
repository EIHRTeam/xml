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
  wikiJsonToXml,
  xmlToSubmitJson,
  xmlToWikiJson,
  type DocumentModel,
} from '../src/index.js'
import { paragraph, textRun } from '../src/model.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/2897-with-chat.json', import.meta.url), 'utf8'))

function dialogWidget(item: any) {
  const { widgets } = item.document.chapterGroup[0]
  const { widgetCommonMap } = item.document
  const descriptor = widgets.find((entry: { id: string }) => widgetCommonMap[entry.id].type === 'dialog')
  return { descriptor, widget: widgetCommonMap[descriptor.id] }
}

function dialogChapter(document: DocumentModel) {
  return document.chapterGroups.flatMap((group) => group.chapters).find((chapter) => chapter.chapterType === 'dialog')!
}

function dialogXml(entries: string, extraAttributes = 'dialog="true"') {
  return `<sklandDocument>
  <itemId>2897</itemId>
  <metainfo><name>Dialog</name><cover/><subTypes/></metainfo>
  <description/>
  <chapters name="正文">
    <chapter name="对话组件-1" size="large" ${extraAttributes}>${entries}</chapter>
  </chapters>
</sklandDocument>`
}

function message(side: 'me' | 'other', contents = '<text>消息</text>', avatar = ' avatar="https://example.com/avatar"') {
  return `<message side="${side}"${avatar}>${contents}</message>`
}

function branch(messages: string) {
  return `<branches><branch name="分支">${messages}</branch></branches>`
}

function assertReferences(item: any) {
  const ids: string[] = []
  const documents: string[] = []
  const documentMap = item.document.documentMap
  function visit(entries: any[]) {
    for (const entry of entries) {
      ids.push(entry.id)
      visit(entry.options.branchList ?? [])
      visit(entry.options.dialogList ?? [])
      for (const content of entry.options.contents ?? []) {
        ids.push(content.id)
        if (content.type !== 'text') continue
        documents.push(content.text)
        const document = documentMap[content.text]
        expect(document).toBeDefined()
        for (const blockId of document.blockIds) {
          expect(document.blockMap[blockId]).toMatchObject({ id: blockId, parentId: document.id })
        }
      }
    }
  }
  visit(dialogWidget(item).widget.dialogList)
  expect(ids.every(Boolean)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(documents).size).toBe(documents.length)
  return documents
}

describe('dialog chapters', () => {
  test('round-trips the complete submit fixture and writes the original dialog shape', () => {
    const original = parseSubmitJson(fixture)[0]
    const xml = submitJsonToXml(fixture).text
    expect(xml).toContain('<chapter size="large" name="对话组件-1" dialog="true">')
    expect(xml).toContain('<emoji id="combat_related__cryo_infliction"></emoji>')
    expect(Array.from(xml.matchAll(/<message\b[^>]*>/g))).toHaveLength(7)
    expect(Array.from(xml.matchAll(/<message\b[^>]* avatar="[^"]+"/g))).toHaveLength(7)
    expect(parseXml(xml)).toEqual(original)

    const fresh = JSON.parse(xmlToSubmitJson(xml).text)
    expect(parseSubmitJson(fresh)[0]).toEqual(original)
    expect(assertReferences(fresh.item)).toHaveLength(10)

    const reused = JSON.parse(xmlToSubmitJson(xml, { referenceJson: fixture }).text)
    const references = assertReferences(reused.item)
    expect(dialogWidget(reused.item)).toEqual(dialogWidget(fixture.item))
    for (const key of references) {
      expect(reused.item.document.documentMap[key]).toEqual(fixture.item.document.documentMap[key])
    }
  })

  test('round-trips a bare Wiki item and an InfoRoot envelope', () => {
    for (const [source, wrapInfoRoot] of [[fixture.item, false], [{ code: 0, data: { item: fixture.item } }, true]] as const) {
      const original = parseWikiJson(source)
      const xml = wikiJsonToXml(source).text
      expect(parseXml(xml)).toEqual(original)
      const rendered = JSON.parse(xmlToWikiJson(xml, { wrapInfoRoot, referenceJson: source }).text)
      expect(parseWikiJson(rendered)).toEqual(original)
      expect(dialogWidget(wrapInfoRoot ? rendered.data.item : rendered)).toEqual(dialogWidget(fixture.item))
    }
  })

  test('preserves text boundaries, explicit breaks, image order and escaped attributes', () => {
    const source = dialogXml(
      message('other', '<text>一<br/><br></br>三 &amp; <emoji id="e"/></text><image src="a?x=1&amp;y=2"/><text>另一个气泡</text>',
        ' avatar="a&amp;&quot;b"') +
      '<divider kind="custom"> 接下来的故事 &lt;下一章&gt; </divider>',
    )
    const model = parseXml(source)
    const json = JSON.parse(renderSubmitJson(model))
    const [entry, divider] = dialogWidget(json.item).widget.dialogList
    const [first, image, last] = entry.options.contents
    expect(entry.options).toMatchObject({ avatarUrl: 'a&"b', name: '' })
    expect(image).toMatchObject({ type: 'image', imageUrl: 'a?x=1&y=2', text: '' })
    const document = json.item.document.documentMap[first.text]
    expect(document.blockIds.map((id: string) => document.blockMap[id].text.inlineElements)).toEqual([
      [{ kind: 'text', text: { text: '一' } }],
      [],
      [{ kind: 'text', text: { text: '三 & ' } }, { kind: 'gameIcon', gameIcon: { id: 'e', text: '' } }],
    ])
    expect(first.text).not.toBe(last.text)
    expect(divider.options).toMatchObject({ type: 'custom', text: ' 接下来的故事 <下一章> ' })
    expect(parseXml(renderXml(model))).toEqual(model)
    expect(dialogChapter(parseSubmitJson(json)[0])).toEqual(dialogChapter(model))
  })

  test.each([undefined, '', ' \t\n '])('rejects invalid avatars (%j) in each format and at both depths', (avatar) => {
    for (const nested of [false, true]) {
      const invalid = message('other', '<text>消息</text>', avatar === undefined ? '' : ` avatar="${avatar}"`)
      expect(() => parseXml(dialogXml(nested ? branch(message('me') + invalid) : invalid)))
        .toThrow(/对话组件-1.*dialogList\[\d+\].*nonempty avatar/)

      const source = structuredClone(fixture)
      const entries = dialogWidget(source.item).widget.dialogList
      const entry = nested ? entries[2].options.branchList[0].options.dialogList[1] : entries[0]
      if (avatar === undefined) delete entry.options.avatarUrl
      else entry.options.avatarUrl = avatar
      expect(() => parseSubmitJson(source)).toThrow(/对话组件-1.*dialogList\[\d+\].*nonempty avatar/)

      const model = parseSubmitJson(fixture)[0]
      const [first, , group] = dialogChapter(model).dialog!
      const modelMessage = nested && group?.type === 'branches' ? group.branches[0]!.messages[1] : first
      if (modelMessage?.type !== 'message') throw new Error('Expected a fixture message.')
      if (avatar === undefined) Reflect.deleteProperty(modelMessage, 'avatarUrl')
      else modelMessage.avatarUrl = avatar
      for (const render of [renderXml, renderSubmitJson, renderWikiJson]) {
        expect(() => render(model)).toThrow(/对话组件-1.*dialogList\[\d+\].*nonempty avatar/)
      }
    }
  })

  test.each([
    [branch(message('other')), /start with 'me' and end with 'other'/],
    [branch(message('me') + message('other') + message('me')), /end with 'other'/],
    [branch(message('me')), /end with 'other'/],
    [branch(message('me', '<image src="a"/>') + message('other')), /first message cannot contain an image/],
    [branch(branch(message('me') + message('other'))), /must be a <message>/],
    ['<branches/>', /must contain at least one branch/],
    [message('me', '<text><b/></text>'), /cannot contain <b> inside <text>/],
    [message('other', '<image/>'), /nonempty image src/],
    ['<divider kind="5"><emoji id="e"/></divider>', /only supports plain text/],
    ['<divider/>', /nonempty divider kind/],
    ['<tab name="内容"/>', /cannot contain <tab>/],
  ])('rejects invalid XML structure %s', (entries, messagePattern) => {
    expect(() => parseXml(dialogXml(entries))).toThrow(messagePattern)
  })

  test('rejects dialog tags in the description and in other chapter modes', () => {
    for (const attribute of ['', 'table="true"', 'audio="true"']) {
      expect(() => parseXml(dialogXml('<branches/>', attribute))).toThrow(/must be inside a dialog chapter/)
    }
    expect(() => parseXml(dialogXml('').replace('<description/>', '<description><message/></description>')))
      .toThrow(/must be inside a dialog chapter/)
    for (const attribute of ['table="true"', 'audio="true"']) {
      expect(() => parseXml(dialogXml('', `dialog="true" ${attribute}`))).toThrow(/cannot mix chapter modes/)
    }
  })

  test('rejects missing JSON text documents and validates text before normalization', () => {
    const source = structuredClone(fixture)
    const first = dialogWidget(source.item).widget.dialogList[0].options.contents[0]
    const document = source.item.document.documentMap[first.text]
    const inline = document.blockMap[document.blockIds[0]].text.inlineElements[0]
    Object.assign(inline, { bold: true, text: { text: '' } })
    expect(() => parseSubmitJson(source)).toThrow(/contents\[0\].*only supports unstyled text and emoji/)
    delete source.item.document.documentMap[first.text]
    expect(() => parseSubmitJson(source)).toThrow(/contents\[0\].*missing documentMap/)
  })

  test('enforces branch rules when reading JSON', () => {
    const source = structuredClone(fixture)
    const entries = dialogWidget(source.item).widget.dialogList
    const branchEntry = entries[2].options.branchList[0]
    const [me, other] = branchEntry.options.dialogList
    branchEntry.options.dialogList = [other, me]
    expect(() => parseSubmitJson(source)).toThrow(/must start with 'me'/)
    branchEntry.options.dialogList = [me]
    expect(() => parseSubmitJson(source)).toThrow(/end with 'other'/)
    branchEntry.options.dialogList = [me, other]
    me.options.contents.push(other.options.contents[1])
    expect(() => parseSubmitJson(source)).toThrow(/first message cannot contain an image/)
    branchEntry.options.dialogList = [me, entries[5], other]
    expect(() => parseSubmitJson(source)).toThrow(/must contain a dialog-me or dialog-other/)
  })

  test('reuses IDs after editing text and moving a message into a branch, and gives copies fresh IDs', () => {
    const model = parseXml(submitJsonToXml(fixture).text)
    const chapter = dialogChapter(model)
    const [moving, edited, group, divider, copied, secondGroup] = chapter.dialog!
    if (moving?.type !== 'message' || edited?.type !== 'message' || group?.type !== 'branches' ||
      divider?.type !== 'divider' || copied?.type !== 'message' || secondGroup?.type !== 'branches') {
      throw new Error('Unexpected fixture shape.')
    }
    group.branches[0]!.messages.push(moving)
    const text = edited.contents[0]
    if (text?.type !== 'text') throw new Error('Expected a text document.')
    text.blocks = [paragraph([textRun('编辑后的对话')])]
    chapter.dialog = [edited, group, divider, copied, structuredClone(copied), secondGroup]

    const rendered = JSON.parse(xmlToSubmitJson(renderXml(model), { referenceJson: fixture }).text)
    const original = dialogWidget(fixture.item)
    const result = dialogWidget(rendered.item)
    expect(result.descriptor.id).toBe(original.descriptor.id)
    const [oldMoving, oldEdited, oldGroup, oldDivider, oldCopied, oldSecondGroup] = original.widget.dialogList
    const [newEdited, newGroup, newDivider, ...remaining] = result.widget.dialogList
    expect(newEdited.id).toBe(oldEdited.id)
    expect(newGroup.id).toBe(oldGroup.id)
    expect(newGroup.options.branchList[0].id).toBe(oldGroup.options.branchList[0].id)
    const newMoving = newGroup.options.branchList[0].options.dialogList.at(-1)
    expect(newMoving.id).toBe(oldMoving.id)
    expect(newMoving.options.contents).toEqual(oldMoving.options.contents)
    expect(newDivider.id).toBe(oldDivider.id)
    expect(remaining[0].id).toBe(oldCopied.id)
    expect(remaining[1].id).not.toBe(oldCopied.id)
    expect(remaining[2].id).toBe(oldSecondGroup.id)

    const editedRef = newEdited.options.contents[0].text
    const movedRef = newMoving.options.contents[0].text
    expect(newEdited.options.contents).toEqual(oldEdited.options.contents)
    const editedDocument = rendered.item.document.documentMap[editedRef]
    const movedDocument = rendered.item.document.documentMap[movedRef]
    expect(editedDocument.blockIds).toEqual(fixture.item.document.documentMap[editedRef].blockIds)
    expect(editedDocument.blockIds).toEqual(movedDocument.blockIds)
    expect(editedDocument.blockMap[editedDocument.blockIds[0]].text.inlineElements)
      .toEqual([{ kind: 'text', text: { text: '编辑后的对话' } }])
    expect(parseSubmitJson(rendered)[0]).toEqual(model)
    expect(assertReferences(rendered.item)).toHaveLength(11)
  })
})
