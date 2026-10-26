/**
 * Static check for the Client half's locale dictionaries.
 *
 * Reads `client.js`, extracts the `ZH` and `EN` object literals, and verifies the
 * two key sets stay identical and use the same `{placeholder}` names — the locale
 * service rejects a namespace whose dictionaries are not balanced.
 */
import fs from 'node:fs'

const file = process.argv[2] ?? './client.js'
const src = fs.readFileSync(file, 'utf8')

function extractLiteral(name) {
  const start = src.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`missing const ${name}`)
  let depth = 0
  let quote = null
  let begin = -1
  for (let index = src.indexOf('{', start); index < src.length; index += 1) {
    const char = src[index]
    if (quote !== null) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') {
      if (depth === 0) begin = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return src.slice(begin, index + 1)
    }
  }
  throw new Error(`unterminated literal ${name}`)
}

function placeholders(text) {
  return (String(text).match(/\{\w+\}/g) ?? []).sort().join(',')
}

const zh = Function(`return (${extractLiteral('ZH')})`)()
const en = Function(`return (${extractLiteral('EN')})`)()
const zhKeys = Object.keys(zh).sort()
const enKeys = Object.keys(en).sort()

const failures = []
for (const key of zhKeys) if (!(key in en)) failures.push(`EN missing key ${key}`)
for (const key of enKeys) if (!(key in zh)) failures.push(`ZH missing key ${key}`)
for (const key of zhKeys) {
  if (!(key in en)) continue
  if (placeholders(zh[key]) !== placeholders(en[key])) failures.push(`placeholder mismatch for ${key}`)
}

console.log(`ZH keys: ${zhKeys.length}; EN keys: ${enKeys.length}`)
if (failures.length > 0) {
  console.error('FAILURES:', failures.join(' | '))
  process.exitCode = 1
} else {
  console.log('locale dictionaries balanced')
}
