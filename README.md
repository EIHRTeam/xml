# @eihrteam/xml

![Node](https://img.shields.io/node/v/%40eihrteam%2Fxml)
![License](https://img.shields.io/github/license/EIHRTeam/xml)
![GitHub top language](https://img.shields.io/github/languages/top/EIHRTeam/xml?logo=typescript)
[![NPM Downloads](https://img.shields.io/npm/d18m/%40eihrteam%2Fxml?logo=npm&label=NPM%20Downloads)
](https://www.npmjs.com/package/@eihrteam/xml)<br>
[![Work With Agent Skill](https://img.shields.io/badge/Work_With_Agent_Skill-EIHRTeam%2fskland--wiki--data--skill-blue?logo=github)](https://github.com/EIHRTeam/skland-wiki-data-skill)


SKLand Endfield Wiki JSON 与 XML 的本地互转工具包。处理 `item/info` 公开读取模型，不含网络请求、签名、认证或 API replay。

## 安装

```bash
pnpm add @eihrteam/xml
```

## 本地开发

构建使用 tsdown，需要 Node.js 22.18+（22.x）、24.11+（24.x）或 26+；建议使用 Node.js 24.11+ 的 24.x LTS 版本。发布产物仍支持 Node.js 20+。

```bash
pnpm install
pnpm check
pnpm pack:dry-run
```

## 基本用法

```ts
import { wikiJsonToXml, wikiJsonToXmlBatch, xmlToWikiJson } from '@eihrteam/xml'

// InfoRoot 或 InfoItem JSON -> XML
const xml = wikiJsonToXml(infoRootJsonText).text

// 批量转换
const batch = wikiJsonToXmlBatch([
  { source: infoRootJsonText, meta: { itemId: '1', path: '终末地百科/物品/id1.json' } },
])

// XML -> InfoItem JSON
const infoItemJson = xmlToWikiJson(xml).text

// XML -> InfoRoot JSON（带外层 envelope）
const infoRootJson = xmlToWikiJson(xml, { wrapInfoRoot: true }).text
```

## CLI

```bash
# JSON -> XML
xml convert --from json --to xml --input item.json --output item.xml

# XML -> JSON
xml convert --from xml --to json --input item.xml --output item.json

# item/update 提交体 -> XML -> item/update 提交体
xml convert --from submit-json --to xml --input submit.json --output item.xml
xml convert --from xml --to submit-json --input item.xml --output submit.json

# 管道模式
cat item.json | xml convert --from json --to xml
```

格式说明：`json` 对应 `item/info` 的 InfoItem/InfoRoot 读取模型，`submit-json` 对应
`item/update` 的 `{ commitMsg, item }` 写入模型，`xml` 对应 `<sklandDocument>` XML。

## API

### 转换函数

| 函数 | 说明 |
|------|------|
| `wikiJsonToXml(json)` | InfoItem/InfoRoot JSON -> XML |
| `xmlToWikiJson(xml, options?)` | XML -> InfoItem/InfoRoot JSON |
| `submitJsonToXml(json)` | item/update SubmitRoot JSON -> XML |
| `xmlToSubmitJson(xml)` | XML -> item/update SubmitRoot JSON |
| `wikiJsonToSubmitJson(json)` | InfoItem/InfoRoot JSON -> item/update SubmitRoot JSON |
| `submitJsonToWikiJson(json)` | item/update SubmitRoot JSON -> InfoItem JSON |
| `wikiJsonToXmlBatch(entries)` | 批量 JSON -> XML |
| `xmlToWikiJsonBatch(entries, options?)` | 批量 XML -> JSON |
| `convert(source, options)` | 通用双向转换 |

### 解析与渲染

| 函数 | 说明 |
|------|------|
| `parseWikiJson(source)` | 解析 JSON 为 `DocumentModel` |
| `parseXml(source)` | 解析 XML 为 `DocumentModel` |
| `renderXml(document)` | `DocumentModel` 渲染为 XML |
| `renderWikiJson(document, options?)` | `DocumentModel` 渲染为 JSON |

### 类型

| 导出 | 说明 |
|------|------|
| `XmlWikiConversionError` | 转换过程中的错误类型 |
| `ConvertOptions` | `convert()` 的选项类型 |
| `RenderWikiJsonOptions` | `renderWikiJson()` 的选项类型 |
| `ConversionResult` | 返回 `{ text, warnings }` |
| `DocumentModel` 及相关 block/inline 类型 | 中间表示模型 |

### ConversionResult

```ts
interface ConversionResult {
  text: string
  warnings: string[]
}
```

### 批量转换

`wikiJsonToXmlBatch(entries)` 接收 `{ source, meta? }[]`，`source` 为单个 InfoRoot 或 InfoItem（字符串或对象）。返回：

```ts
interface WikiJsonToXmlBatchResult<TMeta = unknown> {
  items: Array<ConversionResult & { meta?: TMeta }>
  warnings: string[]
}
```

每个 item 保留输入 `meta` 和单项 `warnings`；顶层 `warnings` 带 batch index 前缀的汇总。单条失败直接抛错，错误信息含 batch index。

`xmlToWikiJsonBatch(entries, options?)` 同理，接收 XML 字符串数组。

## 数据范围

- `json` 范围是 `item/info` 正式页结构（InfoRoot 或 InfoItem），非通用 JSON。
- `submit-json` 范围是 `item/update` 提交结构（SubmitRoot）。
- XML 根节点为 `<sklandDocument>`。
- `<publicMeta>` 保存正式页元数据，如 `lang`、`status`、`tagIds`、`createdUser`、`lastUpdatedUser`、`publishedAtTs`、`mainType`、`subType` 等。
- `brief.description: null` 会保留空简介状态，XML 中表现为 `<description source="null">`。

### 兼容性说明

转换以 `DocumentModel` 语义等价为目标，不承诺字节级 round-trip。生成 JSON 时会重新生成
`widgetCommonMap`、`documentMap`、block、tab 等内部 id，并保持引用关系一致。`audioList[*].id`
是提交态临时字段：生成 `submit-json` 时重新创建，生成 `item/info` 读取模型时省略。

多 Tab 音频组件表示为 `<chapter audio="true">` 内的多个
`<tab name="..." icon="..."><audios>...</audios></tab>`；旧的直属 `<audios>` 平铺格式继续支持。

接受的公开响应边界值：空章节标题、空 `content` / `intro.description` 文档引用、`brief.description: null`、图片 URL 无法反推 id/format 时由 XML 显式保存 `<id>` 与 `<format>`、低于 100px 的表格列宽、复杂表格单元格覆盖关系。

### 表情与注释

`gameIcon` 对应行内标签 `<emoji id="emoji_sns_emoiji_001"></emoji>`，读取也接受自闭合形式。
`id` 必须非空，支持任意图标 ID。标签仅接受 `id` 属性，内部允许排版空白。
JSON 中缺省的 `gameIcon.text` 按空串处理，显式 `null`、其他类型或非空字符串均报错，输出固定为 `text: ""`。

`annotation` 对应行内标签 `<annotation>`，内部必须各有一个 `<title>` 和 `<content>`，两者均可为空。
`title` 保存 `annotation.inlineElements` 的富文本和表情，`content` 保存 `annotation.childIds` 引用的详情块。

```xml
正文中的<annotation><title>标记<b>文字</b><emoji id="emoji_sns_emoiji_001"></emoji></title><content>
    详情文字
    <quote>详情引用</quote>
</content></annotation>及后续文字
```

注释详情支持现有块语法，表格单元格内的注释详情仍禁止嵌套表格。
表格省略 `widths` 时从章节尺寸计算列宽，无章节尺寸的表格须显式指定 `widths`。
注释标题与详情内均禁止再次嵌套注释。文字样式分别在标题、详情内部表达。
详情中的换行独立处理，外层段落中的注释作为完整行内单元保留。
标题、对齐和行内格式容器中的排版换行与普通空白序列继续折叠，组件相邻文字之间保留必要的单个空格。显式 `<br>` 保留换行语义。
两个标签适用于简介、正文、Tab 和图片简介，链接等仅保存纯文本的元素内禁止放入这两个标签。

输出 JSON 时，详情块保存在所属文档的 `blockMap`，由注释 `childIds` 引用，直属块的 `parentId`
指向所属段落。`referenceJson` 支持复用详情块及其内部组件的 ID，图标 ID 始终保留。
读取时以 `childIds` 为准，兼容原始样本中详情块 `parentId` 与所属段落不匹配的历史值。
公开 `Inline` 类型新增 `EmojiInline` 和 `AnnotationInline`。纯文本提取使用注释标题，表情不产生文字。
无效或循环块引用、非法标签内容及嵌套注释均抛出转换错误。

### 对话章节

在 `<chapters>` 内用 `<chapter dialog="true">` 表示一个对话组件。章节至少包含一个条目，
可按序放置 `<message>`、`<branches>` 和 `<divider>`。每个 `<message>` 必须提供 `side="me"` 或
`side="other"` 以及非空的 `avatar`，分支内也一样。省略 `name` 时昵称为空。

```xml
<chapter size="large" name="对话组件-1" dialog="true">
    <message side="other" name="对方名字1" avatar="https://example.com/other.jpg">
        <text>收到图了吗？</text>
        <image src="https://example.com/photo.png"/>
        <text>看右下角。<emoji id="emoji_sns_emoiji_001"/></text>
    </message>
    <branches>
        <branch name="分支1">
            <message side="me" name="我方名字1" avatar="https://example.com/me.png">
                <text>看到了。</text>
            </message>
            <message side="other" avatar="https://example.com/other.jpg">
                <text>那就出发吧。</text>
            </message>
        </branch>
    </branches>
    <divider kind="5"/>
    <message side="other" avatar="https://example.com/other.jpg">
        <text>我在入口等你。</text>
    </message>
</chapter>
```

- `<message>` 内的 `<text>` 和 `<image src="…"/>` 按原顺序转换。每个 `<text>` 对应单独的
  `documentMap` 文档，支持纯文本、`<emoji>` 和 `<br>`。显式换行会生成段落，包括首尾空段落。
  空 `<text>` 表示一个空段落。图片的 `src` 必须非空。
- `<branches>` 至少包含一个带 `name` 属性的 `<branch>`。分支内只允许发言，首条必须为我方且不能带图，
  至少要有一条对方回复，并以对方发言结束。
- `<divider>` 的 `kind` 是非空的样式字符串，对应 JSON 的 `options.type`。可选的纯文本内容对应 `options.text`。
- 对话标签限用于对话章节。JSON 和 XML 双向校验章节结构、头像、分支规则和文字内容。
  使用 `referenceJson` 时，可复用发言、分支、分隔线、消息内容、文档及文档内文字块的 ID。

## 运行时

- Node.js 20 及以上。
- 浏览器环境优先使用 `globalThis.DOMParser`。
- Node 环境使用 `@xmldom/xmldom`。

## 鸣谢

- [曾小皮](https://github.com/ZengXiaoPi) - XML 格式标准与初版 XML-JSON 互转工具

## 许可证

MIT

### Reuse component IDs when editing

Starting with 0.6.0, JSON renderers accept an optional `referenceJson`:

```ts
import { submitJsonToXml, xmlToSubmitJson } from '@eihrteam/xml'

const xml = submitJsonToXml(originalSubmitJson).text
const result = xmlToSubmitJson(editedXml || xml, {
  referenceJson: originalSubmitJson,
})
```

The reference can be a JSON string or object: a submit envelope (`{ item,
commitMsg }`), a Wiki response (`{ data: { item } }`), or a bare item. Its `itemId`
must match the item being rendered. Invalid references throw conversion errors.
The option is also available on `renderSubmitJson`, `renderWikiJson`,
`documentToWikiJsonObject`, `xmlToWikiJson`, `convert` with a Wiki JSON target,
and the direct JSON-to-JSON conversion helpers. `RenderJsonOptions` describes
shared rendering options; `RenderWikiJsonOptions` adds Wiki envelope options.

Matching preserves widget, tab, document, block, list item, table row/column,
audio and video element identities. Exact content is matched first, followed by
unique local titles/resources, then compatible positions between matched
siblings. Unique unchanged content can move between parents; repeated content
is matched in order without reusing one identity for multiple copies. Table
cells follow the matched row and column identities. In ambiguous cases, new
IDs are generated. Resource and business IDs retain their existing semantics.

XML stays unchanged and carries no hidden identity attributes. Empty blocks
removed by existing normalization do not consume other blocks' identities.
This is not a lossless JSON round trip: formatting and existing normalization
of non-ID fields still apply. Without `referenceJson`, IDs are generated
deterministically from the input model. The same input and options produce
identical output, including newly allocated IDs. Editors should cache successful
conversions and use their latest
successful JSON as the next reference so newly inserted components keep their
IDs between diff, format conversion and submission. Failed conversions must
not replace that reference.

### Explicit line breaks

Paragraph newlines (LF, CRLF, CR, `<br></br>` or `<br/>`) are paragraph
boundaries: each line becomes a separate wiki text block. Interior empty lines
become empty body blocks with left alignment; leading and trailing empty lines
are trimmed. Text at paragraph boundaries is trimmed to match XML layout
whitespace handling. Nonempty lines retain the original paragraph kind, alignment and
inline formatting. Links and pronunciations split across lines as well.
This applies inside quotes, list items and table cells. Multiple paragraphs in
one list item stay inside one `<li>`.

XML renders these paragraphs with layout newlines, preserving interior blank
lines without emitting inline `br` elements. When using `referenceJson`, the
first split line can reuse the original block ID; other lines reuse matching
reference IDs or receive deterministic new IDs.

Dialog text preserves leading and trailing empty paragraphs. XML renders
paragraph boundaries in dialog text as `<br></br>` and ignores layout
whitespace at the edges of the text and around those elements.

Audio profiles and image descriptions retain string newline semantics and use
closed `<br></br>` elements in XML. Image-intro descriptions continue to store
one block per line in JSON. Literal text such as `<br>` is escaped normally;
a `br` element with content is rejected.
