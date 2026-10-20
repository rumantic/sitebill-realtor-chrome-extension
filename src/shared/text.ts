/**
 * Общие текстовые утилиты адаптеров. Без DOM: код выполняется в service worker.
 */

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Строка из данных площадки: сущности декодированы, неразрывные пробелы и повторы схлопнуты. */
export function cleanText(s: string): string {
  return decodeEntities(s).replace(/[   ]/g, " ").replace(/s+/g, " ").trim()
}

/** HTML описания → простой текст: абзацы и <br> становятся переводами строк, теги отбрасываются. */
export function htmlToText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Латиница, визуально неотличимая от кириллицы.
const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
}

const hasCyrillic = (s: string) => /[А-Яа-яЁё]/.test(s)
const WORD = /[A-Za-zА-Яа-яЁё]+/g

function fixToken(token: string): string {
  return token.replace(/[A-Za-z]/g, ch => LATIN_TO_CYRILLIC[ch] ?? ch)
}

/**
 * Некоторые площадки подменяют кириллические буквы латинскими двойниками («Прeдлaгaетcя»), чтобы защититься
 * от копирования. Исправляем слова, где кириллица смешана с латиницей, и одиночные латинские буквы
 * рядом с русским текстом («c. Орёл», «в доме a»). Полностью латинские слова не трогаем.
 */
export function fixHomoglyphs(text: string): { text: string, fixed: number } {
  let fixed = 0
  const tokens: { word: string, start: number }[] = []
  for (const m of text.matchAll(WORD)) tokens.push({ word: m[0], start: m.index! })

  const replacements = new Map<number, string>()
  tokens.forEach((t, i) => {
    let next = t.word
    if (t.word.length > 1) {
      if (hasCyrillic(t.word) && /[A-Za-z]/.test(t.word)) next = fixToken(t.word)
    }
    else if (/[A-Za-z]/.test(t.word)) {
      const neighbours = [tokens[i - 1], tokens[i + 1]].filter(Boolean) as { word: string, start: number }[]
      // Сосед считается русским только если он вплотную через пробел/знак препинания (не через строку и абзац)
      const near = neighbours.some(n => hasCyrillic(n.word) && Math.abs((n.start < t.start ? t.start - (n.start + n.word.length) : n.start - (t.start + 1))) <= 2)
      if (near) next = fixToken(t.word)
    }
    if (next !== t.word) {
      replacements.set(t.start, next)
      fixed++
    }
  })

  if (!fixed) return { text, fixed: 0 }
  let out = ''
  let pos = 0
  for (const t of tokens) {
    const r = replacements.get(t.start)
    if (r === undefined) continue
    out += text.slice(pos, t.start) + r
    pos = t.start + t.word.length
  }
  out += text.slice(pos)
  return { text: out, fixed }
}

/** «146.2 м²» → 146.2; «1 250,5» → 1250.5; не число → undefined. */
export function parseNumber(s: string | undefined | null): number | undefined {
  if (!s) return undefined
  const m = s.replace(/[\s ]/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/)
  if (!m) return undefined
  const n = Number(m[0])
  return Number.isFinite(n) ? n : undefined
}

/**
 * Площадь с единицей измерения: сотки — отдельно (участок), гектары переводятся в сотки, остальное — м².
 * Граница слова \b в JS не работает с кириллицей, поэтому «га» ищем через lookaround.
 */
export function parseAreaValue(value: string | undefined | null): { sqm?: number, sotka?: number } {
  const n = parseNumber(value)
  if (n === undefined) return {}
  if (/сот/i.test(value!)) return { sotka: n }
  if (/(?<![а-яё])га(?![а-яё])/i.test(value!)) return { sotka: n * 100 }
  return { sqm: n }
}

// Телефон в свободном тексте: «8 (900) 111-22-33», «+7 900 111 22 33», «8/900/111/22/33», «89001112233», «900 111 22 33».
// Разделители между цифрами — пробел, дефис, точка, скобки, слэш. Цены («24 000 000») и площади под шаблон не подпадают:
// нужна ровно та группировка, что у российских номеров (код + 3 + 2 + 2).
const PHONE_RE = /(?<!\d)(?:(?:\+7|8|7)[\s\-.()/]*)?\(?9\d{2}\)?[\s\-.()/]*\d{3}[\s\-.()/]*\d{2}[\s\-.()/]*\d{2}(?!\d)/g
const PHONE_8800_RE = /(?<!\d)(?:\+7|8)[\s\-.()/]*\(?800\)?[\s\-.()/]*\d{3}[\s\-.()/]*\d{2}[\s\-.()/]*\d{2}(?!\d)/g

/** Убирает телефоны из описания: контакты продавца в новое объявление не переносим. */
export function removePhones(text: string): { text: string, removed: number } {
  let removed = 0
  const strip = (s: string, re: RegExp) => s.replace(re, () => { removed++; return '' })
  let out = strip(strip(text, PHONE_RE), PHONE_8800_RE)
  if (!removed) return { text, removed: 0 }
  // Остатки после удаления: пустые скобки/двоеточия на конце строки, лишние пробелы
  out = out
    .replace(/[ \t]+([,.;!?])/g, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.') // «тел. 8905…» + точка предложения → «тел..»
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
  return { text: out, removed }
}

/** Описание объявления перед переносом: исправляет подмену кириллицы латиницей и удаляет телефоны. */
export function sanitizeDescription(text: string): { text: string, fixed: number, phones: number } {
  const noPhones = removePhones(text)
  const fixed = fixHomoglyphs(noPhones.text)
  return { text: fixed.text.trim(), fixed: fixed.fixed, phones: noPhones.removed }
}
