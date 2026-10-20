/**
 * Минимальный разбор HTML без DOM — в service worker нет DOMParser.
 *
 * Нужен адаптерам площадок, у которых данных нет в JSON и их приходится брать из серверной разметки
 * (Яндекс.Недвижимость). Классы там CSS-модульные: `OfferCardHighlight__value--GOzzA`, хеш после `--` меняется
 * от сборки к сборке, поэтому ищем по стабильной части (`OfferCardHighlight__value`), а не по полному имени.
 */
import { decodeEntities } from './text'

export interface HtmlElement {
  tag: string
  /** Строка атрибутов открывающего тега */
  attrs: string
  /** Внутренний HTML (без самого элемента) */
  inner: string
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Убирает то, что не содержит данных и только раздувает разбор: script, style, svg, комментарии. */
export function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
}

/** Класс подходит, если совпадает полностью либо это имя с хешем сборки (`name--abc12`). */
export function hasClass(classAttr: string, name: string): boolean {
  return classAttr.split(/\s+/).some(token => token === name || token.startsWith(`${name}--`))
}

export function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  const value = m?.[1] ?? m?.[2]
  return value === undefined ? undefined : decodeEntities(value)
}

/** Внутренний HTML элемента: от конца открывающего тега до парного закрывающего (вложенные такие же теги учтены). */
function readInner(html: string, from: number, tag: string): string {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi')
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1]) depth--
    else if (!m[2]) depth++
    if (depth === 0) return html.slice(from, m.index)
  }
  return html.slice(from)
}

/** Все элементы, у которых есть CSS-класс `name` (с учётом хеша сборки), в порядке следования в документе. */
export function findByClass(html: string, name: string): HtmlElement[] {
  const out: HtmlElement[] = []
  const startTag = /<([a-zA-Z][\w-]*)\b([^>]*?)>/g
  let m: RegExpExecArray | null
  while ((m = startTag.exec(html))) {
    const [full, tag, attrs] = m as unknown as [string, string, string]
    const cls = attr(attrs, 'class')
    if (!cls || !hasClass(cls, name)) continue
    const lower = tag.toLowerCase()
    out.push({ tag: lower, attrs, inner: VOID_TAGS.has(lower) || full.endsWith('/>') ? '' : readInner(html, m.index + full.length, lower) })
  }
  return out
}

/** Видимый текст фрагмента: переносы из <br> и блочных тегов сохраняются, сущности декодируются, пробелы схлопнуты. */
export function textOf(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t  ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Содержимое всех `<script type="application/ld+json">`, уже разобранное; битые блоки пропускаются. */
export function readJsonLd(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]!))
    }
    catch { /* битый блок — пропускаем */ }
  }
  return out
}
