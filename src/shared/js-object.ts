/**
 * Состояние страницы, сериализованное в JS-литерал (`window.__SSR_STATE__={...}`), — не всегда валидный JSON:
 * сериализатор оставляет `undefined`, `NaN`, `Infinity`. Заменяем эти значения на null (вне строк) и разбираем
 * обычным JSON.parse — без eval, который в расширении запрещён.
 */

const LITERALS = ['undefined', 'NaN', 'Infinity']
const IDENT = /[A-Za-z0-9_$]/

export function jsObjectToJson(text: string): string {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    const literal = LITERALS.find(l => text.startsWith(l, i))
    if (literal && !IDENT.test(text[i - 1] ?? '') && !IDENT.test(text[i + literal.length] ?? '')) {
      // «-Infinity»: знак уже попал в out — убираем, иначе получится «-null»
      if (literal === 'Infinity' && out.endsWith('-')) out = out.slice(0, -1)
      out += 'null'
      i += literal.length - 1
      continue
    }
    out += ch
  }
  return out
}

export function parseJsObject(text: string): unknown | null {
  try {
    return JSON.parse(jsObjectToJson(text))
  }
  catch {
    return null
  }
}
