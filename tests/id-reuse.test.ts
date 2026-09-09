import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { IdFactory } from '../src/ids.js'
import {
  parseSubmitJson,
  parseXml,
  renderSubmitJson,
  renderXml,
  submitJsonToXml,
  xmlToSubmitJson,
  xmlToWikiJson,
  type Block,
  type Chapter,
  type ComplexTableBlock,
} from '../src/index.js'
import { paragraph, textRun } from '../src/model.js'

const sample = readFileSync(new URL('./fixtures/sample.xml', import.meta.url), 'utf8')
const p = (text: string): Block => paragraph([textRun(text)])
const chapter = (title: string, content: Block[] = []): Chapter => ({
  title,
  size: 'large',
  chapterType: 'common',
  content,
  tabs: [],
  audios: [],
  tableRows: [],
})
function source(chapters: Chapter[]) {
  const model = parseXml(sample)
  model.description = []
  model.chapterGroups = [{ title: 'Group', chapters }]
  return JSON.parse(renderSubmitJson(model))
}
function edit(reference: any, change: (model: ReturnType<typeof parseXml>) => void) {
  const model = parseSubmitJson(reference)[0]
  change(model)
  return JSON.parse(xmlToSubmitJson(renderXml(model), { referenceJson: reference }).text)
}
function widget(item: any, index = 0) {
  const descriptor = item.document.chapterGroup[0].widgets[index]
  return { descriptor, data: item.document.widgetCommonMap[descriptor.id] }
}
function doc(item: any, index = 0) {
  return item.document.documentMap[widget(item, index).data.tabDataMap.default.content]
}
function assertReferences(item: any) {
  for (const group of item.document.chapterGroup) {
    for (const entry of group.widgets) expect(item.document.widgetCommonMap[entry.id]).toBeDefined()
  }
  for (const data of Object.values(item.document.widgetCommonMap) as any[]) {
    for (const tab of data.tabList) expect(data.tabDataMap[tab.tabId]).toBeDefined()
    for (const tab of Object.values(data.tabDataMap) as any[]) {
      if (tab.content) expect(item.document.documentMap[tab.content]).toBeDefined()
      if (tab.intro?.description) expect(item.document.documentMap[tab.intro.description]).toBeDefined()
    }
  }
  for (const document of [item.brief.description, ...Object.values(item.document.documentMap)] as any[]) {
    if (!document) continue
    const parents = new Set([document.id, ...Object.keys(document.blockMap)])
    const refs: Array<[string, string[]]> = [[document.id, document.blockIds]]
    for (const [id, block] of Object.entries(document.blockMap) as Array<[string, any]>) {
      expect(block.id).toBe(id)
      if (block.quote) refs.push([id, block.quote.childIds])
      if (block.list) {
        expect(block.list.id).toBe(id)
        for (const itemId of block.list.itemIds) {
          expect(block.list.itemMap[itemId].id).toBe(itemId)
          parents.add(itemId)
          refs.push([itemId, block.list.itemMap[itemId].childIds])
        }
      }
      if (block.table) {
        expect(block.table.id).toBe(id)
        for (const row of block.table.rowIds) expect(block.table.rowMap[row].id).toBe(row)
        for (const col of block.table.columnIds) expect(block.table.columnMap[col].id).toBe(col)
        for (const [key, cell] of Object.entries(block.table.cellMap) as Array<[string, any]>) {
          expect(cell.id).toBe(key)
          expect(
            block.table.rowIds.some((row: string) =>
              block.table.columnIds.some((col: string) => key === `${row}_${col}`),
            ),
          ).toBe(true)
          parents.add(key)
          refs.push([key, cell.childIds])
        }
      }
    }
    for (const [parent, ids] of refs) {
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(document.blockMap[id]?.parentId).toBe(parent)
    }
    for (const block of Object.values(document.blockMap) as any[]) expect(parents.has(block.parentId)).toBe(true)
  }
}

describe('reference JSON identities', () => {
  test('preserves all IDs across the rich fixture including tables, nested lists, audio and intros', () => {
    const original = JSON.parse(renderSubmitJson(parseXml(sample)))
    const output = xmlToSubmitJson(submitJsonToXml(original).text, { referenceJson: original })
    expect(JSON.parse(output.text)).toEqual(original)
    assertReferences(original.item)
  })

  test('accepts all reference envelopes and rejects invalid or different items', () => {
    const original = source([chapter('One', [p('hello')])])
    const xml = submitJsonToXml(original).text
    for (const referenceJson of [
      original,
      original.item,
      { data: { item: original.item } },
      JSON.stringify(original),
    ]) {
      expect(JSON.parse(xmlToSubmitJson(xml, { referenceJson }).text)).toEqual(original)
      expect(JSON.parse(xmlToWikiJson(xml, { referenceJson }).text).document).toEqual(original.item.document)
    }
    expect(() => xmlToSubmitJson(xml, { referenceJson: '{' })).toThrow()
    expect(() => xmlToSubmitJson(xml, { referenceJson: {} })).toThrow()
    expect(() => xmlToSubmitJson(xml, { referenceJson: { ...original.item, itemId: 'other' } })).toThrow(/itemId/)
    expect(() => xmlToSubmitJson(xml, { referenceJson: { ...original.item, document: {} } })).toThrow()
  })

  test('retains IDs for text and title edits and a nonstandard document root', () => {
    const original = source([chapter('One', [p('hello'), p('world')])])
    const before = doc(original.item)
    before.id = 'custom-root'
    for (const block of Object.values(before.blockMap) as any[]) block.parentId = 'custom-root'
    const output = edit(original, (model) => {
      model.chapterGroups[0]!.chapters[0]!.title = 'Renamed'
      model.chapterGroups[0]!.chapters[0]!.content[0] = p('edited')
    })
    expect(widget(output.item).descriptor.id).toBe(widget(original.item).descriptor.id)
    expect(doc(output.item).blockIds).toEqual(before.blockIds)
    expect(doc(output.item).id).toBe('custom-root')
    assertReferences(output.item)
  })

  test.each(['start', 'middle', 'delete', 'reorder'] as const)('preserves unaffected blocks on %s', (operation) => {
    const original = source([chapter('One', [p('A'), p('B'), p('C')])])
    const ids = doc(original.item).blockIds
    const output = edit(original, (model) => {
      const list = model.chapterGroups[0]!.chapters[0]!.content
      if (operation === 'start') list.unshift(p('new'))
      if (operation === 'middle') list.splice(1, 0, p('new'))
      if (operation === 'delete') list.splice(1, 1)
      if (operation === 'reorder') list.reverse()
    })
    const result = doc(output.item).blockIds
    if (operation === 'start') expect(result.slice(1)).toEqual(ids)
    if (operation === 'middle') expect([result[0], ...result.slice(2)]).toEqual(ids)
    if (operation === 'delete') expect(result).toEqual([ids[0], ids[2]])
    if (operation === 'reorder') expect(result).toEqual([...ids].reverse())
    assertReferences(output.item)
  })

  test('matches unique moves across containers and does not reuse an ID twice for copied content', () => {
    const original = source([chapter('One', [p('move me'), p('stay')]), chapter('Two', [p('second')])])
    const movedId = doc(original.item).blockIds[0]
    const moved = edit(original, (model) => {
      const [one, two] = model.chapterGroups[0]!.chapters
      two!.content.push(one!.content.shift()!)
    })
    expect(doc(moved.item, 1).blockIds[1]).toBe(movedId)
    const copied = edit(original, (model) => {
      const list = model.chapterGroups[0]!.chapters[0]!.content
      list.push(structuredClone(list[0]!))
    })
    expect(new Set(doc(copied.item).blockIds).size).toBe(3)
    expect(doc(copied.item).blockIds[0]).toBe(movedId)
    assertReferences(moved.item)
    assertReferences(copied.item)
  })

  test('handles duplicate titles, duplicate paragraphs, type replacement and clipped empty paragraphs', () => {
    const original = source([chapter('Same', [p('duplicate'), p('duplicate')]), chapter('Same', [p('distinct')])])
    const first = doc(original.item)
    const copy = structuredClone(first.blockMap[first.blockIds[0]])
    copy.id = 'trimmed-empty'
    copy.text.inlineElements = []
    first.blockMap[copy.id] = copy
    first.blockIds.unshift(copy.id)
    const output = edit(original, (model) => {
      model.chapterGroups[0]!.chapters.reverse()
    })
    expect(doc(output.item, 1).blockIds).toEqual(first.blockIds.slice(1))
    const replaced = edit(original, (model) => {
      model.chapterGroups[0]!.chapters[0]!.content[0] = { blockType: 'horizontalLine', kind: 'single' }
    })
    expect(doc(replaced.item).blockIds[0]).not.toBe(first.blockIds[1])
    assertReferences(replaced.item)
  })

  function table(): ComplexTableBlock {
    return {
      blockType: 'complexTable',
      headerMode: 'none',
      rowCount: 2,
      columnCount: 2,
      columnWidths: [100, 200],
      cells: [0, 1].flatMap((rowIndex) =>
        [0, 1].map((columnIndex) => ({
          rowIndex,
          columnIndex,
          rowSpan: 1,
          colSpan: 1,
          blocks: [p(`${rowIndex}:${columnIndex}`)],
        })),
      ),
    }
  }
  test.each(['row', 'column'] as const)('retains table identities when inserting a %s', (axis) => {
    const original = source([chapter('Table', [table()])])
    const before = Object.values(doc(original.item).blockMap).find((b: any) => b.table) as any
    const output = edit(original, (model) => {
      const value = model.chapterGroups[0]!.chapters[0]!.content[0] as ComplexTableBlock
      if (axis === 'row') {
        value.rowCount++
        value.cells.forEach((cell) => cell.rowIndex++)
        for (let columnIndex = 0; columnIndex < 2; columnIndex++)
          value.cells.push({ rowIndex: 0, columnIndex, rowSpan: 1, colSpan: 1, blocks: [p(`new ${columnIndex}`)] })
      } else {
        value.columnCount++
        value.columnWidths.unshift(50)
        value.cells.forEach((cell) => cell.columnIndex++)
        for (let rowIndex = 0; rowIndex < 2; rowIndex++)
          value.cells.push({ rowIndex, columnIndex: 0, rowSpan: 1, colSpan: 1, blocks: [p(`new ${rowIndex}`)] })
      }
    })
    const after = doc(output.item).blockMap[before.id].table
    if (axis === 'row') {
      expect(after.rowIds.slice(1)).toEqual(before.table.rowIds)
      expect(after.columnIds).toEqual(before.table.columnIds)
    } else {
      expect(after.columnIds.slice(1)).toEqual(before.table.columnIds)
      expect(after.rowIds).toEqual(before.table.rowIds)
    }
    for (const key of Object.keys(before.table.cellMap)) expect(after.cellMap[key]).toEqual(before.table.cellMap[key])
    assertReferences(output.item)
  })

  test('preserves audio identities when all editable fields change and video element identity', () => {
    const audio: Chapter = {
      ...chapter('Audio'),
      chapterType: 'audio',
      audioTabs: [
        {
          title: 'Chinese',
          icon: null,
          audios: [{ title: 'Old', profile: 'Old text', resourceUrl: 'https://old.test/a.wav' }],
        },
        {
          title: 'English',
          icon: null,
          audios: [{ title: 'Keep', profile: 'Keep text', resourceUrl: 'https://old.test/b.wav' }],
        },
      ],
    }
    const original = source([
      audio,
      chapter('Video', [{ blockType: 'externalVideo', videoKind: 'bilibili', videoId: 'BV12345' }]),
    ])
    const output = edit(original, (model) => {
      model.chapterGroups[0]!.chapters[0]!.audioTabs![0]!.audios[0] = {
        title: 'New',
        profile: 'New text',
        resourceUrl: 'https://new.test/a.wav',
      }
    })
    const before = widget(original.item).data
    const after = widget(output.item).data
    expect(after.tabList).toEqual(before.tabList)
    for (const tab of before.tabList)
      expect(after.tabDataMap[tab.tabId].audioList[0].id).toBe(before.tabDataMap[tab.tabId].audioList[0].id)
    expect(doc(output.item, 1)).toEqual(doc(original.item, 1))
    assertReferences(output.item)
  })
  test('reserves even discarded IDs and retries random collisions', () => {
    const original = source([chapter('One', [p('stay')])])
    const data = doc(original.item)
    const discarded = 'aaaaaaaaaaaa'
    data.blockMap[discarded] = {
      ...structuredClone(data.blockMap[data.blockIds[0]]),
      id: discarded,
      text: { kind: 'body', inlineElements: [] },
    }
    data.blockIds.unshift(discarded)
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
      ;(array as Uint8Array).fill(0)
      return array
    })
    try {
      const output = edit(original, (model) => {
        model.chapterGroups[0]!.chapters[0]!.content.push(p('new'))
      })
      expect(doc(output.item).blockIds[1]).not.toBe(discarded)
      expect(new IdFactory(new Set([discarded])).blockId()).not.toBe(discarded)
      expect(random.mock.calls.length).toBeGreaterThanOrEqual(2)
      assertReferences(output.item)
    } finally {
      random.mockRestore()
    }
  })

  test('preserves unusual map keys without changing object prototypes', () => {
    const original = source([chapter('One', [p('keep')])])
    const oldWidget = widget(original.item)
    const oldId = oldWidget.descriptor.id
    original.item.document.chapterGroup[0].widgets[0].id = '__proto__'
    Object.defineProperty(original.item.document.widgetCommonMap, '__proto__', {
      value: oldWidget.data,
      enumerable: true,
    })
    delete original.item.document.widgetCommonMap[oldId]
    const output = edit(original, () => {})
    expect(Object.hasOwn(output.item.document.widgetCommonMap, '__proto__')).toBe(true)
    assertReferences(output.item)
  })

  test('supports deeply nested identity trees without expanding escaped subtree signatures', () => {
    let block = p('leaf')
    for (let index = 0; index < 30; index++) block = { blockType: 'quote', children: [block] }
    const original = source([chapter('Nested', [block])])
    expect(edit(original, () => {})).toEqual(original)
  })

  test.each(['row', 'column'] as const)('preserves retained table identities after deleting a %s', (axis) => {
    const original = source([chapter('Table', [table()])])
    const before = Object.values(doc(original.item).blockMap).find((block: any) => block.table) as any
    const output = edit(original, (model) => {
      const value = model.chapterGroups[0]!.chapters[0]!.content[0] as ComplexTableBlock
      if (axis === 'row') {
        value.rowCount--
        value.cells = value.cells.filter((cell) => cell.rowIndex === 1)
        value.cells.forEach((cell) => cell.rowIndex--)
      } else {
        value.columnCount--
        value.columnWidths.shift()
        value.cells = value.cells.filter((cell) => cell.columnIndex === 1)
        value.cells.forEach((cell) => cell.columnIndex--)
      }
    })
    const after = doc(output.item).blockMap[before.id].table
    expect(after.rowIds).toEqual(axis === 'row' ? before.table.rowIds.slice(1) : before.table.rowIds)
    expect(after.columnIds).toEqual(axis === 'column' ? before.table.columnIds.slice(1) : before.table.columnIds)
    assertReferences(output.item)
  })

  test('keeps caller-owned reference and model values unchanged and honors changed intro text', () => {
    const original = JSON.parse(renderSubmitJson(parseXml(sample)))
    const model = parseSubmitJson(original)[0]
    const intro = model.chapterGroups
      .flatMap((group) => group.chapters)
      .flatMap((entry) => entry.tabs)
      .find((tab) => tab.intro)?.intro
    expect(intro).toBeTruthy()
    intro!.description = [textRun('Edited intro')]
    const snapshot = structuredClone(model)
    const originalSnapshot = structuredClone(original)
    const output = JSON.parse(renderSubmitJson(model, { referenceJson: original }))
    expect(model).toEqual(snapshot)
    expect(original).toEqual(originalSnapshot)
    expect(submitJsonToXml(output).text).toContain('Edited intro')
    // The option-free renderer must not use parser-side intro caches either.
    expect(submitJsonToXml(renderSubmitJson(model)).text).toContain('Edited intro')
  })
  test('keeps local list-item and row/column namespaces independent', () => {
    const list = (text: string): Block => ({ blockType: 'list', ordered: false, items: [{ blocks: [p(text)] }] })
    const original = source([chapter('Lists and tables', [list('one'), list('two'), table()])])
    const data = doc(original.item)
    for (const block of Object.values(data.blockMap) as any[]) {
      if (!block.list) continue
      const oldId = block.list.itemIds[0]
      const item = block.list.itemMap[oldId]
      item.id = 'shared-local-id'
      for (const child of item.childIds) data.blockMap[child].parentId = item.id
      block.list.itemIds = [item.id]
      block.list.itemMap = { [item.id]: item }
    }
    const value = (Object.values(data.blockMap).find((block: any) => block.table) as any).table
    const oldColumn = value.columnIds[0]
    const newColumn = value.rowIds[0]
    value.columnIds[0] = newColumn
    value.columnMap[newColumn] = { ...value.columnMap[oldColumn], id: newColumn }
    delete value.columnMap[oldColumn]
    for (const row of value.rowIds) {
      const previous = `${row}_${oldColumn}`
      const id = `${row}_${newColumn}`
      const cell = value.cellMap[previous]
      cell.id = id
      for (const child of cell.childIds) data.blockMap[child].parentId = id
      value.cellMap[id] = cell
      delete value.cellMap[previous]
    }
    const output = edit(original, () => {})
    expect(output).toEqual(original)
    assertReferences(output.item)
  })

  test('retains table axes and remaining cell identities when merging cells', () => {
    const original = source([chapter('Table', [table()])])
    const before = Object.values(doc(original.item).blockMap).find((block: any) => block.table) as any
    const output = edit(original, (model) => {
      const value = model.chapterGroups[0]!.chapters[0]!.content[0] as ComplexTableBlock
      value.cells[0]!.colSpan = 2
      value.cells.splice(1, 1)
    })
    const after = doc(output.item).blockMap[before.id].table
    expect(after.rowIds).toEqual(before.table.rowIds)
    expect(after.columnIds).toEqual(before.table.columnIds)
    const unchanged = `${before.table.rowIds[1]}_${before.table.columnIds[1]}`
    expect(after.cellMap[unchanged]).toEqual(before.table.cellMap[unchanged])
    assertReferences(output.item)
  })
})


test('deterministic ID generation skips reserved candidates and preserves the alphabet', () => {
  const first = new IdFactory(new Set(), false, 'same input').blockId()
  const reserved = new Set([first])
  const second = new IdFactory(reserved, false, 'same input').blockId()
  expect(second).not.toBe(first)
  expect(second).toMatch(/^[a-zA-Z0-9]{12}$/)
  expect(new IdFactory(new Set([first]), false, 'same input').blockId()).toBe(second)
})
