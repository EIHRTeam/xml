import { IdFactory } from './ids.js'
import { identity, withIdentity, type Identity } from './identity.js'
import { normalizeBlocks, type Block, type DocumentModel, type ImageIntro } from './model.js'

interface Node {
  object: object
  type: string
  keys: string[]
  children: Record<string, Node[]>
  signature: string
  movable: boolean
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    )
  }
  return value
}

interface Tree {
  root: Node
  tables: Array<{ block: Block; rows: Node[]; columns: Node[]; cells: Node[] }>
}

function tree(
  document: DocumentModel,
  introBlocks: (intro: ImageIntro) => Block[],
  source: boolean,
  signatures: Map<string, string>,
): Tree {
  // Intern structural signatures instead of embedding escaped subtree strings.
  // The index is shared by the two trees and released after this conversion.
  function node(
    object: object,
    type: string,
    value: unknown,
    children: Record<string, Node[]> = {},
    keys: string[] = [],
    movable = true,
  ): Node {
    const key = JSON.stringify([
      type,
      canonicalValue(value),
      Object.entries(children).map(([role, nodes]) => [role, nodes.map((entry) => entry.signature)]),
    ])
    let signature = signatures.get(key)
    if (signature === undefined) {
      signature = String(signatures.size)
      signatures.set(key, signature)
    }
    return { object, type, children, keys: keys.filter(Boolean), movable, signature }
  }
  const tables: Tree['tables'] = []
  const blocks = (items: Block[]): Node[] => {
    const normalized = normalizeBlocks(items)
    items.splice(0, items.length, ...normalized)
    return items.map(blockNode)
  }
  const documentNode = (items: Block[]): Node => node(items, 'document', null, { blocks: blocks(items) }, [], false)
  function blockNode(block: Block): Node {
    switch (block.blockType) {
      case 'paragraph':
        return node(block, 'paragraph', [block.kind, block.align, block.inlines])
      case 'quote':
        return node(block, 'quote', null, { blocks: blocks(block.children) })
      case 'list':
        return node(block, 'list', block.ordered, {
          items: block.items.map((item) => node(item, 'listItem', null, { blocks: blocks(item.blocks) })),
        })
      case 'complexTable': {
        const ids = identity(block)
        const cells = block.cells.map((cell) =>
          node(cell, 'cell', [cell.rowSpan, cell.colSpan], { blocks: blocks(cell.blocks) }, [], false),
        )
        const rows = Array.from({ length: block.rowCount }, (_, index) => {
          const object = withIdentity({}, ids.rowIds?.[index] ? { id: ids.rowIds[index] } : {})
          return node(
            object,
            'row',
            cells.filter((_, i) => block.cells[i]!.rowIndex === index).map((cell) => cell.signature),
            {},
            [],
            false,
          )
        })
        const columns = Array.from({ length: block.columnCount }, (_, index) => {
          const object = withIdentity({}, ids.columnIds?.[index] ? { id: ids.columnIds[index] } : {})
          return node(
            object,
            'column',
            [
              block.columnWidths[index],
              cells.filter((_, i) => block.cells[i]!.columnIndex === index).map((cell) => cell.signature),
            ],
            {},
            [],
            false,
          )
        })
        tables.push({ block, rows, columns, cells })
        return node(block, 'complexTable', block.headerMode, { rows, columns, cells })
      }
      case 'image':
        return node(block, 'image', block, {}, [`resource:${block.imageId}`, `url:${block.url}`])
      case 'externalVideo':
        return node(block, 'externalVideo', block, {}, [`video:${block.videoKind}:${block.videoId}`])
      case 'horizontalLine':
        return node(block, 'horizontalLine', block.kind)
    }
  }
  const audioNodes = (items: DocumentModel['chapterGroups'][number]['chapters'][number]['audios']): Node[] =>
    items.map((audio) =>
      node(audio, 'audio', audio, {}, [
        audio.title && `title:${audio.title}`,
        audio.resourceUrl && `url:${audio.resourceUrl}`,
      ]),
    )
  const root = node(
    document,
    'root',
    null,
    {
      description: [documentNode(document.description)],
      groups: document.chapterGroups.map((group) =>
        node(
          group,
          'group',
          group.title,
          {
            chapters: group.chapters.map((chapter) =>
              node(
                chapter,
                `chapter:${chapter.chapterType}`,
                [chapter.title, chapter.size, chapter.tableRows],
                {
                  content: [documentNode(chapter.content)],
                  audios: audioNodes(chapter.audios),
                  tabs: (chapter.audioTabs ?? chapter.tabs).map((tab) => {
                    if ('audios' in tab)
                      return node(
                        tab,
                        'audioTab',
                        [tab.title ?? '', tab.icon ?? ''],
                        { audios: audioNodes(tab.audios) },
                        [tab.title ? `title:${tab.title}` : ''],
                      )
                    const intro = tab.intro
                    const description = intro
                      ? source
                        ? (identity(intro).introBlocks ?? introBlocks(intro))
                        : introBlocks(intro)
                      : null
                    return node(
                      tab,
                      'tab',
                      [tab.title ?? '', tab.icon ?? '', intro && [intro.name, intro.introType, intro.imageUrl]],
                      {
                        content: [documentNode(tab.content)],
                        intro: description ? [documentNode(description)] : [],
                      },
                      [tab.title ? `title:${tab.title}` : ''],
                    )
                  }),
                },
                [chapter.title && `title:${chapter.title}`],
              ),
            ),
          },
          [group.title && `title:${group.title}`],
        ),
      ),
    },
    [],
    false,
  )
  return { root, tables }
}

function flatten(root: Node): Node[] {
  return [root, ...Object.values(root.children).flatMap((children) => children.flatMap(flatten))]
}

function buckets(nodes: Node[], key: (node: Node) => string): Map<string, Node[]> {
  const result = new Map<string, Node[]>()
  for (const entry of nodes) {
    const value = key(entry)
    const list = result.get(value) ?? []
    list.push(entry)
    result.set(value, list)
  }
  return result
}

/** Match identities before writing any JSON references. No string-wide ID replacement. */
export function prepareIdReuse(
  document: DocumentModel,
  reference: DocumentModel,
  introBlocks: (intro: ImageIntro) => Block[],
  reserved: Set<string> = new Set<string>(),
): IdFactory {
  // Work with normalized model nodes so discarded empty blocks cannot consume IDs.
  const signatures = new Map<string, string>()
  const next = tree(document, introBlocks, false, signatures)
  const old = tree(reference, introBlocks, true, signatures)
  const matches = new Map<Node, Node>()
  const used = new Set<Node>()
  const nextNodes = flatten(next.root)
  const oldNodes = flatten(old.root)
  const oldGlobal = buckets(
    oldNodes.filter((n) => n.movable),
    (n) => n.signature,
  )
  const nextGlobal = buckets(
    nextNodes.filter((n) => n.movable),
    (n) => n.signature,
  )

  function pair(current: Node, previous: Node): boolean {
    if (matches.has(current) || used.has(previous) || current.type !== previous.type) return false
    matches.set(current, previous)
    used.add(previous)
    return true
  }

  function matchSiblings(current: Node[], previous: Node[]): void {
    const available = () => current.filter((n) => !matches.has(n))
    const remaining = () => previous.filter((n) => !used.has(n))
    // Unique exact content first; then unique title/resource keys within this parent.
    function unique(key: (n: Node) => string): void {
      const a = buckets(available(), key)
      const b = buckets(remaining(), key)
      for (const [value, entries] of a) {
        const candidates = b.get(value)
        if (entries.length === 1 && candidates?.length === 1) pair(entries[0]!, candidates[0]!)
      }
    }
    unique((n) => n.signature)
    const keys = new Set(available().flatMap((n) => n.keys))
    for (const key of keys) {
      const a = available().filter((n) => n.keys.includes(key))
      const b = remaining().filter((n) => n.keys.includes(key))
      if (a.length === 1 && b.length === 1) pair(a[0]!, b[0]!)
    }
    // Global matches are restricted to unique, unchanged semantic subtrees.
    for (const entry of available()) {
      const candidates = oldGlobal.get(entry.signature)
      if (entry.movable && nextGlobal.get(entry.signature)?.length === 1 && candidates?.length === 1)
        pair(entry, candidates[0]!)
    }
    // Ordered duplicate content (LCS) avoids assigning one identity to copies.
    const a = available()
    const b = remaining()
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i]![j] =
          a[i]!.signature === b[j]!.signature
            ? lengths[i + 1]![j + 1]! + 1
            : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i]!.signature === b[j]!.signature) {
        pair(a[i++]!, b[j++]!)
      } else if (lengths[i + 1]![j]! > lengths[i]![j + 1]!) i++
      else j++
    }
    // Use monotonic matched siblings as anchors. Only equal, compatible gaps align.
    const anchors: Array<[number, number]> = [[-1, -1]]
    let lastOldIndex = -1
    current.forEach((entry, index) => {
      const match = matches.get(entry)
      const oldIndex = match ? previous.indexOf(match) : -1
      if (oldIndex > lastOldIndex) {
        anchors.push([index, oldIndex])
        lastOldIndex = oldIndex
      }
    })
    anchors.push([current.length, previous.length])
    for (let index = 1; index < anchors.length; index++) {
      const [startA, startB] = anchors[index - 1]!
      const [endA, endB] = anchors[index]!
      const gapA = current.slice(startA + 1, endA).filter((n) => !matches.has(n))
      const gapB = previous.slice(startB + 1, endB).filter((n) => !used.has(n))
      if (gapA.length === gapB.length && gapA.every((n, k) => n.type === gapB[k]!.type)) {
        gapA.forEach((n, k) => pair(n, gapB[k]!))
      }
    }
  }

  pair(next.root, old.root)
  const visited = new Set<Node>()
  function descend(current: Node): void {
    if (visited.has(current)) return
    visited.add(current)
    const previous = matches.get(current)
    for (const [role, children] of Object.entries(current.children)) {
      // Table cells are aligned by matched row AND column, below, never by flat index.
      if (current.type === 'complexTable' && role === 'cells') continue
      matchSiblings(children, previous?.children[role] ?? [])
      children.forEach(descend)
    }
    if (current.type === 'complexTable') {
      const currentTable = next.tables.find((table) => table.block === current.object)!
      const oldTable = old.tables.find((table) => table.block === previous?.object)
      if (oldTable && currentTable.block.blockType === 'complexTable' && oldTable.block.blockType === 'complexTable') {
        const previousBlock = oldTable.block
        currentTable.cells.forEach((cellNode, index) => {
          const cell = currentTable.block.blockType === 'complexTable' ? currentTable.block.cells[index]! : null
          if (!cell) return
          const row = oldTable.rows.indexOf(matches.get(currentTable.rows[cell.rowIndex]!)!)
          const col = oldTable.columns.indexOf(matches.get(currentTable.columns[cell.columnIndex]!)!)
          const oldIndex = previousBlock.cells.findIndex((c) => c.rowIndex === row && c.columnIndex === col)
          if (oldIndex >= 0) pair(cellNode, oldTable.cells[oldIndex]!)
        })
      }
      currentTable.cells.forEach(descend)
    }
  }
  descend(next.root)

  for (const entry of oldNodes) {
    const ids = identity(entry.object)
    for (const value of [ids.id, ids.documentId, ids.elementId, ...(ids.rowIds ?? []), ...(ids.columnIds ?? [])]) {
      if (value) reserved.add(value)
    }
  }
  // Business video IDs are also block-map keys; fresh IDs must not collide with them.
  for (const entry of nextNodes) {
    if (entry.type === 'externalVideo') reserved.add((entry.object as { videoId: string }).videoId)
  }
  for (const [entry, previous] of matches) {
    const ids = identity(previous.object)
    // Intro caches and table vectors refer to source nodes; assign those separately.
    const selected: Identity = {}
    if (ids.id) selected.id = ids.id
    if (ids.documentId) selected.documentId = ids.documentId
    if (ids.elementId) selected.elementId = ids.elementId
    withIdentity(entry.object, selected)
  }
  const factory = new IdFactory(reserved, true, JSON.stringify(document))
  for (const table of next.tables) {
    withIdentity(table.block, {
      ...identity(table.block),
      rowIds: table.rows.map((row) => identity(row.object).id ?? factory.itemId()),
      columnIds: table.columns.map((col) => identity(col.object).id ?? factory.itemId()),
    })
  }
  return factory
}
