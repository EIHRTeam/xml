#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  submitJsonToWikiJson,
  submitJsonToXml,
  wikiJsonToSubmitJson,
  wikiJsonToXml,
  xmlToSubmitJson,
  xmlToWikiJson,
} from './convert.js'

const HELP = `Usage: xml <command> [options]

Commands:
  convert    Convert between formats

Options:
  --from <format>    Input format: json | xml | submit-json
  --to <format>      Output format: json | xml | submit-json
  --input <path>     Input file (default: stdin)
  --output <path>    Output file (default: stdout)
  -h, --help         Show this help

Format notes:
  'json' is an alias for the wiki InfoItem/InfoRoot JSON format.
  'submit-json' is the item/update submission format.
`

const FORMATS = new Set(['json', 'xml', 'submit-json'])

type Converter = (source: string) => { text: string; warnings: string[] }

const CONVERSION_MAP: Record<string, Converter> = {
  'json->xml': wikiJsonToXml,
  'xml->json': xmlToWikiJson,
  'submit-json->xml': submitJsonToXml,
  'xml->submit-json': xmlToSubmitJson,
  'json->submit-json': wikiJsonToSubmitJson,
  'submit-json->json': submitJsonToWikiJson,
}

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: 'string', short: 'f' },
    to: { type: 'string', short: 't' },
    input: { type: 'string', short: 'i' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const command = positionals[0]
if (!command) {
  process.stdout.write(HELP)
  process.exit(0)
}

if (command !== 'convert') {
  fail(`Unknown command: ${command}. Run with --help for usage.`)
}

const from = values.from
const to = values.to
if (!from || !to) {
  fail('Both --from and --to are required.')
}
if (!FORMATS.has(from)) {
  fail(`Invalid --from format: ${from}. Must be one of: json, xml, submit-json`)
}
if (!FORMATS.has(to)) {
  fail(`Invalid --to format: ${to}. Must be one of: json, xml, submit-json`)
}

if (!values.input && process.stdin.isTTY) {
  fail('No input provided. Use --input <path> or pipe data via stdin.')
}

const source = values.input
  ? readFileSync(values.input, 'utf8')
  : readFileSync(0, 'utf8')

let result: { text: string; warnings: string[] }

if (from === to) {
  result = { text: source, warnings: [] }
} else {
  const converter = CONVERSION_MAP[`${from}->${to}`]
  if (!converter) {
    fail(`Unsupported conversion: ${from} -> ${to}`)
  }
  result = converter(source)
}

for (const warning of result.warnings) {
  console.error(`Warning: ${warning}`)
}

if (values.output) {
  writeFileSync(values.output, result.text, 'utf8')
} else {
  process.stdout.write(result.text)
}
