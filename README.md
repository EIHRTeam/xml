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

## 运行时

- Node.js 20 及以上。
- 浏览器环境优先使用 `globalThis.DOMParser`。
- Node 环境使用 `@xmldom/xmldom`。

## 鸣谢

- [曾小皮](https://github.com/ZengXiaoPi) - XML 格式标准与初版 XML-JSON 互转工具

## 许可证

MIT
