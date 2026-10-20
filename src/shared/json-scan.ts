/**
 * Вырезает из текста сбалансированное JSON-значение (`[...]` или `{...}`), начинающееся в позиции start.
 * Учитывает строки и экранирование, поэтому скобки внутри строк не ломают разбор.
 * Нужно там, где данные страницы лежат прямо в JS (`window.x = [...]`) и не обёрнуты в JSON.parse("...").
 */
export function sliceBalanced(text: string, start: number): string | null {
  const open = text[start]
  if (open !== '[' && open !== '{') return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
