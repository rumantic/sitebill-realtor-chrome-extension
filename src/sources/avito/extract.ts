/**
 * Извлечение данных объявления из HTML страницы Авито.
 *
 * Данные лежат в `window.__staticRouterHydrationData = JSON.parse("<строка JS с экранированным JSON>")`.
 * Разбор — без DOM и без eval (service worker): ищем строковый литерал, снимаем экранирование как JSON-строку.
 */

const MARKER = 'window.__staticRouterHydrationData = JSON.parse('

export interface AvitoParamItem {
  attributeId?: number
  title?: string
  description?: string
}

export interface AvitoParamBlock {
  items?: AvitoParamItem[]
  data?: { items?: AvitoParamItem[] }
}

export interface AvitoItem {
  id?: number
  title?: string
  price?: number
  formattedPrice?: { postfix?: string, currencySign?: string }
  url?: string
  categoryId?: number
  category?: { id?: number, slug?: string }
  description?: string
  geo?: { address?: string, coords?: { lat?: number, lng?: number } }
  address?: string
  imageUrls?: Record<string, string>[]
  breadcrumbs?: { name?: string }[]
  houseParams?: AvitoParamBlock
  rentTermsParams?: AvitoParamBlock
  rulesParams?: AvitoParamBlock
  conditionParams?: AvitoParamBlock
  shortTermRent?: { isShortTermRentCategory?: boolean }
  seo?: { canonicalUrl?: string }
  isClosed?: boolean
  isArchived?: boolean
  isDeleted?: boolean
}

export interface AvitoBuyerItem {
  item?: AvitoItem
  paramsBlock?: AvitoParamBlock
  ga?: { categorySlug?: string }[]
  priceString?: string
  normalizedPricePostfix?: string
}

export type ExtractResult =
  | { kind: 'ok', buyerItem: AvitoBuyerItem }
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

/** Читает JS-строковый литерал, начинающийся с `"` в позиции start; возвращает содержимое литерала (с экранированием). */
function readStringLiteral(html: string, start: number): string | null {
  if (html[start] !== '"') return null
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i]
    if (ch === '\\') i++
    else if (ch === '"') return html.slice(start + 1, i)
  }
  return null
}

/** Превращает содержимое JS-литерала в JSON-совместимое (`\'`, `\xNN` бывают в JS, но недопустимы в JSON). */
function jsLiteralToJson(raw: string): string {
  return raw
    .replace(/\\'/g, '\'')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => `\\u00${h}`)
}

export function extractHydration(html: string): unknown | null {
  const at = html.indexOf(MARKER)
  if (at < 0) return null
  const raw = readStringLiteral(html, at + MARKER.length)
  if (raw === null) return null
  try {
    const inner = JSON.parse(`"${jsLiteralToJson(raw)}"`) as string
    return JSON.parse(inner)
  }
  catch {
    return null
  }
}

const BLOCK_MARKERS = [/Доступ ограничен/i, /captcha/i, /firewall/i, /Проверка безопасности/i, /Подозрительная активность/i]

export function extractListing(html: string, status = 200): ExtractResult {
  if (status === 404 || status === 410) return { kind: 'not_found' }

  const data = extractHydration(html) as { loaderData?: Record<string, { buyerItem?: AvitoBuyerItem } | null> } | null
  const buyerItem = data?.loaderData?.['catalog-or-main-or-item']?.buyerItem
  if (buyerItem?.item?.id) {
    const it = buyerItem.item
    if (it.isDeleted || it.isClosed || it.isArchived) return { kind: 'not_found' }
    return { kind: 'ok', buyerItem }
  }

  if (status === 429 || status === 403 || status === 302 || BLOCK_MARKERS.some(re => re.test(html))) return { kind: 'blocked' }
  return { kind: 'unknown' }
}
