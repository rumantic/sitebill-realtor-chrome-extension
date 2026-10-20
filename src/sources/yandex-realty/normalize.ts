import {
  LISTING_SCHEMA_VERSION,
  type DealType,
  type ImportedListing,
  type ImportedParam,
  type PropertyKind,
} from '../../shared/protocol'
import { cleanText, sanitizeDescription, parseAreaValue, parseNumber } from '../../shared/text'
import { buildTitle } from '../../shared/title'
import { absolutize, type YandexRaw } from './extract'

export const YANDEX_REALTY_ADAPTER_VERSION = 1

const CATEGORY_KIND: Record<string, PropertyKind> = {
  APARTMENT: 'flat',
  ROOMS: 'room',
  HOUSE: 'house',
  LOT: 'land',
  GARAGE: 'garage',
  COMMERCIAL: 'commercial',
}

/** Сделка: заголовок страницы («Купить …», «Снять …») надёжнее всего, запасной вариант — раздел в хлебных крошках. */
export function dealFromRaw(raw: YandexRaw): DealType | null {
  const urls = raw.breadcrumbUrls.join(' ')
  if (/посуточно|на сутки/i.test(raw.title) || /posutochno|na-sutki|sutki/i.test(urls)) return 'rent_daily'
  if (/^\s*(снять|сдать|сдаётся|сдается)/i.test(raw.title) || /\/snyat\//.test(urls)) return 'rent_long'
  if (/^\s*(купить|продать|продаётся|продается)/i.test(raw.title) || /\/kupit\//.test(urls)) return 'sale'
  return null
}

export function kindFromRaw(raw: YandexRaw): PropertyKind | null {
  const category = raw.product.category
  if (category && CATEGORY_KIND[category]) return CATEGORY_KIND[category]
  const urls = raw.breadcrumbUrls.join(' ')
  if (/\/kvartira\//.test(urls)) return 'flat'
  if (/\/komnata\/|\/komnaty\//.test(urls)) return 'room'
  if (/\/dom\//.test(urls)) return 'house'
  if (/\/uchastok\//.test(urls)) return 'land'
  if (/\/garazh\//.test(urls)) return 'garage'
  if (/\/kommercheskaya/.test(urls)) return 'commercial'
  return category ? 'other' : null
}

/** «Купить 3-комнатную квартиру…» → 3, «Купить студию…» → студия. */
export function roomsFromTitle(title: string): { rooms?: number, studio: boolean } {
  if (/студи/i.test(title)) return { studio: true }
  const m = title.match(/(\d+)\s*-?\s*комнат/i)
  return m ? { rooms: Number(m[1]), studio: false } : { studio: false }
}

/**
 * Особенность карточки («Санузел раздельный», «Кирпичное здание», «Отделка — косметический ремонт») → параметр.
 * Подписи подогнаны под те, что понимает маппер платформы («Ремонт», «Тип дома», «Высота потолков»).
 */
export function featureToParam(text: string, index: number): ImportedParam | null {
  const t = cleanText(text)
  if (!t) return null
  const key = `feature.${index}`

  // Цена за м² уже есть в цене и площади; площади комнат одной строкой — отдельный параметр
  if (/₽\s*за\s*м²/i.test(t)) return null
  if (/^(\d+(?:[.,]\d+)?\s*м²\s*)+$/i.test(t)) return { key, label: 'Площадь комнат', value: t }

  const dash = t.match(/^(.+?)\s+[—–-]\s+(.+)$/)
  if (dash) {
    const label = /^отделка$/i.test(dash[1]!) ? 'Ремонт' : dash[1]!
    return { key, label, value: dash[2]! }
  }
  if (/здани[ея]$/i.test(t)) return { key, label: 'Тип дома', value: t }
  const ceiling = t.match(/^(\d+(?:[.,]\d+)?)\s*м\s+потолки$/i)
  if (ceiling) return { key, label: 'Высота потолков', value: `${ceiling[1]} м` }
  if (/^\d+\s+этаж/i.test(t)) return { key, label: 'Этажность дома', value: t }
  if (/^Дом\s+\d{4}\s*г/i.test(t)) return { key, label: 'Год постройки', value: t.replace(/^Дом\s+/i, '') }
  if (/^Санузел\s+/i.test(t)) return { key, label: 'Санузел', value: t.replace(/^Санузел\s+/i, '') }
  if (/^Вид из окон\s+/i.test(t)) return { key, label: 'Вид из окон', value: t.replace(/^Вид из окон\s+/i, '') }
  if (/парковка$/i.test(t)) return { key, label: 'Парковка', value: t }
  // «Лоджия», «Интернет», «Мебель» — наличие
  return { key, label: t, value: 'есть' }
}

export function normalizeYandexRealty(raw: YandexRaw, now = new Date()): ImportedListing {
  const warnings: string[] = []
  const product = raw.product
  const sourceId = String(product.sku)

  const deal = dealFromRaw(raw)
  const kind = kindFromRaw(raw)
  const { rooms, studio } = roomsFromTitle(raw.title)

  const params: ImportedParam[] = []
  if (studio) params.push({ key: 'rooms', label: 'Количество комнат', value: 'студия' })

  // Основные показатели (плашки): площади, этаж, потолки, год постройки
  let total: number | undefined
  let living: number | undefined
  let kitchen: number | undefined
  let landSotka: number | undefined
  let floor: number | undefined
  let floorsTotal: number | undefined
  let buildYear: number | undefined

  for (const h of raw.highlights) {
    const label = h.label.toLowerCase()
    const area = parseAreaValue(h.value)
    const floorMatch = h.value.match(/(\d+)\s*этаж/i)

    if (floorMatch && /из\s*\d+/i.test(h.label)) {
      floor = Number(floorMatch[1])
      floorsTotal = Number(h.label.match(/из\s*(\d+)/i)![1])
    }
    else if (label === 'общая' || label === 'дом') total = area.sqm ?? total
    else if (label === 'жилая') living = area.sqm ?? living
    else if (label === 'кухня') kitchen = area.sqm ?? kitchen
    else if (/участ/.test(label)) landSotka = area.sotka ?? (area.sqm !== undefined ? area.sqm / 100 : landSotka)
    else if (label === 'потолки') params.push({ key: 'ceiling', label: 'Высота потолков', value: h.value })
    else if (label === 'год постройки') buildYear = parseNumber(h.value)
    else if (area.sqm !== undefined && /площад/.test(label)) total = total ?? area.sqm
    else params.push({ key: `highlight.${params.length}`, label: h.label || h.value, value: h.value })
  }

  let idx = 0
  for (const f of raw.features) {
    const p = featureToParam(f, idx++)
    if (!p) continue
    // Высота потолков уже взята с плашки
    if (p.label === 'Высота потолков' && params.some(x => x.label === p.label)) continue
    if (p.label === 'Год постройки') {
      buildYear ??= parseNumber(p.value)
      continue
    }
    if (p.label === 'Этажность дома') {
      floorsTotal ??= parseNumber(p.value)
      continue
    }
    params.push(p)
  }

  const id = sourceId
  const listing: ImportedListing = {
    schema: LISTING_SCHEMA_VERSION,
    source: 'yandex-realty',
    sourceId: id,
    sourceUrl: `https://realty.yandex.ru/offer/${id}/`,
    adapterVersion: YANDEX_REALTY_ADAPTER_VERSION,
    fetchedAt: now.toISOString(),
    partial: false,
    deal,
    category: { sourceId: product.category, path: product.category ? [product.category] : [] },
    propertyKind: kind,
    params,
    photos: dedupePhotos(raw, product.image),
    warnings,
  }

  const title = buildTitle({ kind, studio, rooms, total, floor, floorsTotal, landSotka })
  if (title) listing.title = title

  if (raw.description) {
    const fixed = sanitizeDescription(raw.description)
    listing.description = fixed.text
    if (fixed.fixed) warnings.push('description_homoglyphs_fixed')
    if (fixed.phones) warnings.push('description_phone_removed')
  }

  const price = product.offers?.price
  if (typeof price === 'number') {
    if (product.offers?.priceCurrency && !/^(RUR|RUB)$/i.test(product.offers.priceCurrency)) warnings.push('price_currency_unknown')
    listing.price = { value: price, currency: 'RUB' }
    if (deal === 'rent_long') listing.price.period = 'month'
    else if (deal === 'rent_daily') listing.price.period = 'day'
  }

  if (raw.address) {
    listing.address = { raw: cleanText(raw.address) }
    if (raw.lat !== undefined && raw.lng !== undefined) {
      listing.address.lat = raw.lat
      listing.address.lng = raw.lng
    }
  }

  const area: NonNullable<ImportedListing['area']> = {}
  if (total !== undefined) area.total = total
  if (living !== undefined) area.living = living
  if (kitchen !== undefined) area.kitchen = kitchen
  if (landSotka !== undefined) area.landSotka = landSotka
  if (Object.keys(area).length) listing.area = area

  if (studio) listing.rooms = 0
  else if (rooms !== undefined) listing.rooms = rooms
  if (floor !== undefined) listing.floor = floor
  if (floorsTotal !== undefined) listing.floorsTotal = floorsTotal
  if (buildYear !== undefined) listing.buildYear = buildYear

  if (!params.length) warnings.push('no_params')
  if (!listing.price) warnings.push('no_price')
  if (!listing.address) warnings.push('no_address')
  if (!listing.photos.length) warnings.push('no_photos')
  if (deal === null) warnings.push('deal_unknown')
  if (kind === null) warnings.push('kind_unknown')
  listing.partial = warnings.some(w => ['no_params', 'no_price', 'no_address', 'deal_unknown', 'kind_unknown'].includes(w))

  return listing
}

/**
 * Фото: слайды галереи; если галерея не отрисована на сервере — первое фото из ld+json
 * (там один и тот же снимок во всех размерах, поэтому берём только первый размер).
 */
function dedupePhotos(raw: YandexRaw, ldImages: string[] | undefined) {
  const urls = raw.galleryUrls.length ? raw.galleryUrls : (ldImages?.slice(0, 1).map(absolutize) ?? [])
  const seen = new Set<string>()
  return urls.filter(u => /^https:\/\//.test(u) && !seen.has(u) && seen.add(u)).map(url => ({ url }))
}
