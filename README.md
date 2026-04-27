# @eihrteam/xml

`@eihrteam/xml` 是 SKLand 终末地 Wiki 正式页 JSON 与 XML 的本地互转工具包。

本包处理 `item/info` 的公开读取模型：输入 JSON 可以是完整响应包裹
`InfoRoot`，也可以是 `data.item` 里的 `InfoItem`。它不发送网络请求，不处理
`item/update` 提交体，不签名请求，不管理 `Did`、`Cred`、token，也不做草稿清理、
diff 或 API replay。

## 安装

```bash
pnpm add @eihrteam/xml
```

## 基本用法

```ts
import { wikiJsonToXml, wikiJsonToXmlBatch, xmlToWikiJson } from '@eihrteam/xml'

const xml = wikiJsonToXml(infoRootJsonText).text
const batch = wikiJsonToXmlBatch([
  { source: infoRootJsonText, meta: { itemId: '1', path: '终末地百科/物品/id1.json' } },
])
const infoItemJson = xmlToWikiJson(xml).text
const infoRootJson = xmlToWikiJson(xml, { wrapInfoRoot: true }).text
```

## API

- `xmlToWikiJson(xml, options?)`
- `wikiJsonToXml(json)`
- `wikiJsonToXmlBatch(entries)`
- `convert(source, { from, to, ...options })`
- `parseWikiJson(source)`
- `parseXml(source)`
- `renderWikiJson(document, options?)`
- `renderXml(document)`
- `XmlWikiConversionError`

只支持 `'xml'` 与 `'wiki-json'` 两种格式。`ConversionResult` 返回：

```ts
interface ConversionResult {
  text: string
  warnings: string[]
}
```

`wikiJsonToXmlBatch(entries)` 接收 `{ source, meta? }[]`，其中 `source` 是单个
`InfoRoot` 或 `InfoItem`。返回值为：

```ts
interface WikiJsonToXmlBatchResult<TMeta = unknown> {
  items: Array<ConversionResult & { meta?: TMeta }>
  warnings: string[]
}
```

每个 `items[]` 元素保留输入 `meta` 和单项 `warnings`；顶层 `warnings` 是带 batch
index 前缀的汇总。任一条目转换失败会直接抛错，错误信息包含失败的 batch index。

## 数据范围

- JSON 范围是 `item/info` 正式页结构，不是通用 JSON，也不是 `item/update` 提交结构。
- XML 根节点是 `<sklandDocument>`。
- `<publicMeta>` 保存正式页元数据，例如 `lang`、`status`、`tagIds`、`createdUser`、
  `lastUpdatedUser`、`publishedAtTs`、`lastAuditPassedAt`、`mainType`、`subType` 等。
- `brief.description: null` 会按正式页的空简介状态保留，XML 中表现为
  `<description source="null">`。

## 兼容性说明

转换以 `DocumentModel` 语义等价为目标，不承诺字节级 round-trip。生成 JSON 时会重新生成
`widgetCommonMap`、`documentMap`、block、tab、audio 等内部 id，但会保持引用关系一致。

为兼容 `TheSklandDataSource` 当前正式页数据，本包接受以下公开响应边界值：

- 空章节标题。
- 空 `content` / `intro.description` 文档引用。
- `brief.description: null`。
- 图片 URL 无法反推图片 id/format 时，由 XML 显式保存 `<id>` 与 `<format>`。
- 正式页中低于 100px 的表格列宽。
- 正式页中已存在的复杂表格单元格覆盖关系。

`~/TheSklandDataSource` 若改用 XML 作为主数据储存格式，建议只在输入层增加 loader：

1. `index.json.files` 仍作为遍历入口。
2. 每个 XML 文件读取后调用 `xmlToWikiJson(xml, { wrapInfoRoot: true })`。
3. 将转换得到的 `InfoRoot` 交给现有构建、提取和配方转换逻辑。
4. 输出、下载资源、配方抽取、`entry` 关系解析继续由 `TheSklandDataSource` 负责。

`item/info` 与 `item/update` 的网络模型差异不属于本包职责。

## 运行时

- Node.js 是主要运行环境，要求 Node 20 或更高版本。
- 浏览器环境优先使用原生 `globalThis.DOMParser`。
- Node 环境使用 `@xmldom/xmldom`，不依赖 `jsdom`。

## 发布流程

仓库包含两个 GitHub Actions workflow：

- `CI`：在 `main`、Pull Request 和手动触发时运行 Node 20/22/24 的
  `pnpm check`，并在 Node 24 上校验 npm 包内容。
- `Publish`：在 GitHub Release 发布或手动指定 tag 时运行检查、校验
  `package.json` 版本与 tag 一致，然后执行 `npm publish --access public --provenance`。

推荐发布步骤：

1. 更新 `package.json` 的 `version`。
2. 提交并推送。
3. 创建匹配版本的 tag，例如 `v0.1.0`。
4. 在 GitHub 创建并发布 Release，触发 npm 发布。

发布到 npm 推荐使用 npm Trusted Publishing；如果未启用 Trusted Publishing，也可以在
GitHub 仓库的 Actions secrets 中配置 `NPM_TOKEN` 作为回退。
