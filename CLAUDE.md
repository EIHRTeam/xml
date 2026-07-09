# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test              # vitest run (single test file: tests/converter.test.ts)
pnpm typecheck         # tsc --noEmit
pnpm build             # tsup src/index.ts src/cli.ts --format esm --dts --clean --target es2022 --minify
pnpm check             # typecheck + test + build (CI gate)
pnpm pack:dry-run      # build + dry-run pack for verifying package contents
```

## Architecture

This package converts between Wiki JSON (`item/info` API response) and a custom XML format (`<sklandDocument>`). All paths go through a shared **DocumentModel** intermediate representation.

**Three data formats:**

| Format | Source | Root shape |
|--------|--------|------------|
| Wiki JSON | `item/info` response | `InfoRoot { data: { item: InfoItem } }` or bare `InfoItem` |
| XML | `<sklandDocument>` with `<itemId>`, `<metainfo>`, `<description>`, `<chapters>` | Custom schema |
| DocumentModel | Internal only | `src/model.ts` — typed block/inline tree |

**Core pipeline:**

```
Wiki JSON ──[jsonFormat.ts:documentFromJsonText]──> DocumentModel ──[xmlFormat.ts:documentToXmlText]──> XML
XML ────────[xmlFormat.ts:documentFromXmlText]───> DocumentModel ──[jsonFormat.ts:documentToJsonText]──> Wiki JSON
```

**Key modules:**

- `src/model.ts` — DocumentModel types (Block, Inline, Chapter, etc.) plus guards (`isParagraph`, `isTextRun`), constructors (`textRun`, `paragraph`), and `normalizeBlocks` which trims empty paragraphs and merges adjacent text runs.
- `src/jsonFormat.ts` — Parses nested JSON payload (blockMap/childIds/itemMap structure) into DocumentModel; renders DocumentModel back to the same JSON structure with fresh IDs via IdFactory.
- `src/xmlFormat.ts` — Parses XML elements (h1-h3, ul/ol, table, img, video, inline tags) into DocumentModel; renders DocumentModel to XML string via manual string building (no DOM construction).
- `src/convert.ts` — Public conversion API (`wikiJsonToXml`, `xmlToWikiJson`, batch variants, `convert`). Batch functions are fail-fast: any entry failure throws immediately.
- `src/cli.ts` — CLI entry (`xml convert --from json|xml --to json|xml`). Uses a `CONVERSION_MAP` lookup table keyed by `"from->to"`.
- `src/ids.ts` — `IdFactory` generates random alphanumeric IDs (widget, block, item, tab, external-video `element`) using `crypto.getRandomValues`.
- `src/xmlDom.ts` — XML parsing wrapper. Prefers native `globalThis.DOMParser` when available, falls back to `@xmldom/xmldom`.
- `src/colors.ts` / `src/constants.ts` — Color name mappings (`JSON_TO_XML_COLOR`, `XML_TO_JSON_COLOR`), inline/block tag sets, entry type mappings, table width defaults.

**JSON input shape detection** (`extractInfoItem` in `jsonFormat.ts`):
- Has `data.item` → InfoRoot (strips envelope, saves `infoRootMeta`)
- Has `brief` and `document` → InfoItem directly

**XML parsing** uses two-tier detection: native `DOMParser.parseFromString` first, `@xmldom/xmldom` fallback. Both paths check for `<parsererror>` element after parsing.

**Round-trip semantics:** Conversion targets DocumentModel equivalence, not byte-level identity. Rendered JSON regenerates all internal IDs (`widgetCommonMap`, `documentMap`, block ids) while preserving referential integrity. Exception: external-video blocks (see below).

**External videos** (`<video kind="skland|bilibili" id="…"></video>`) map to/from JSON `externalVideo` blocks (`ExternalVideoBlock` in `model.ts`). Unlike every other block, the block id **and** its `blockMap` key equal the video id (`externalVideo.id`), not a fresh `IdFactory` id — only the editor-internal `elementId` is regenerated on render. `kind` is validated against `VIDEO_KINDS` (`{skland, bilibili}`) in both directions; `type: "external-video"` and `children: [{text: ""}]` are constants reproduced on render.

**The `warnings` field** in `ConversionResult` exists in the type signature but is never populated in current code paths — all converters return `[]`.
