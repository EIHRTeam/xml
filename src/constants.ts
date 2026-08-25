export const XML_ENTRY_TO_JSON: Record<string, string> = {
  'card-big': 'card-big',
  'link-img': 'link-imgText',
  'link-txt': 'link-text',
}

export const JSON_ENTRY_TO_XML = Object.fromEntries(
  Object.entries(XML_ENTRY_TO_JSON).map(([xmlKey, jsonValue]) => [jsonValue, xmlKey])
) as Record<string, string>

export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'b',
  'i',
  'u',
  's',
  'color',
  'pron',
  'a',
  'entry',
])
export const BASE_BLOCK_TAGS: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'quote',
  'ul',
  'ol',
  'align',
  'img',
  'line',
  'video',
])
export const VIDEO_KINDS: ReadonlySet<string> = new Set(['skland', 'bilibili'])
export const TABLE_TOTAL_WIDTH_BY_SIZE: Record<string, number> = {
  large: 1160,
  middle: 754.7,
  small: 349.3,
}

export const SCALE_COLOR_SET: ReadonlySet<string> = new Set([
  'light_text_secondary',
  'light_text_tertiary',
  'light_text_quaternary',
])
