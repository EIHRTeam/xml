export const XML_ENTRY_TO_JSON: Record<string, string> = {
  'card-big': 'card-big',
  'link-img': 'link-imgText',
  'link-txt': 'link-text',
}

export const JSON_ENTRY_TO_XML = Object.fromEntries(
  Object.entries(XML_ENTRY_TO_JSON).map(([xmlKey, jsonValue]) => [jsonValue, xmlKey])
) as Record<string, string>

const JSON_TO_XML_COLOR: Record<string, string> = {
  light_text_primary: 's_1',
  light_text_secondary: 's_2',
  light_text_tertiary: 's_3',
  light_text_quaternary: 's_4',
  light_rank_gray: 'r_1',
  light_rank_green: 'r_2',
  light_rank_blue: 'r_3',
  light_rank_purple: 'r_4',
  light_rank_yellow: 'r_5',
  light_rank_orange: 'r_6',
  light_function_orange: 'f_orange',
  light_function_turquoise: 'f_turquoise',
  light_function_green: 'f_green',
  light_function_sandstone: 'f_sandstone',
  light_function_yellow: 'f_yellow',
  light_function_red: 'f_red',
  light_function_blue: 'f_blue',
  light_function_brown: 'f_brown',
  light_function_violet: 'f_violet',
  light_function_blueness: 'f_blueness',
}

const XML_TO_JSON_COLOR = Object.fromEntries(
  Object.entries(JSON_TO_XML_COLOR).map(([jsonName, xmlName]) => [xmlName, jsonName])
) as Record<string, string>

export const INLINE_TAGS = new Set(['b', 'i', 'u', 's', 'color', 'pron', 'a', 'entry'])
export const BASE_BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'quote', 'ul', 'ol', 'align', 'img', 'line'])
export const TABLE_TOTAL_WIDTH_BY_SIZE: Record<string, number> = {
  large: 1160,
  middle: 754.7,
  small: 349.3,
}

export const SCALE_COLOR_SET = new Set([
  'light_text_secondary',
  'light_text_tertiary',
  'light_text_quaternary',
])
