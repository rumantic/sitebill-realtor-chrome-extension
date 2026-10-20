import {
  LISTING_SCHEMA_VERSION,
  type DealType,
  type ImportedListing,
  type ImportedParam,
  type ImportedPhoto,
  type PropertyKind,
} from '../../shared/protocol'
import { cleanText, decodeEntities, sanitizeDescription, htmlToText, parseAreaValue, parseNumber } from '../../shared/text'
import type { AvitoBuyerItem, AvitoItem, AvitoParamBlock } from './extract'

export const AVITO_ADAPTER_VERSION = 1

const CATEGORY_KIND: Record<string, PropertyKind> = {
  kvartiry: 'flat',
  komnaty: 'room',
  doma_dachi_kottedzhi: 'house',
  zemelnye_uchastki: 'land',
  garazhi_i_mashinomesta: 'garage',
  kommercheskaya_nedvizhimost: 'commercial',
}

function collectParams(item: AvitoItem, buyer: AvitoBuyerItem): ImportedParam[] {
  const blocks: (AvitoParamBlock | undefined)[] = [
    buyer.paramsBlock, item.houseParams, item.conditionParams, item.rentTermsParams, item.rulesParams,
  ]
  const seen = new Set<string>()
  const out: ImportedParam[] = []
  for (const block of blocks) {
    const items = block?.items ?? block?.data?.items ?? []
    for (const p of items) {
      const label = cleanText(p.title ?? '')
      const value = cleanText(p.description ?? '')
      if (!label || !value || seen.has(label)) continue
      seen.add(label)
      out.push({ key: p.attributeId !== undefined ? String(p.attributeId) : label, label, value })
    }
  }
  return out
}

/** Параметры ищем по подписи: attributeId у продажи и аренды одной и той же характеристики различаются. */
function paramByLabel(params: ImportedParam[], ...labels: string[]): string | undefined {
  for (const label of labels) {
    const found = params.find(p => p.label.toLowerCase() === label.toLowerCase())
    if (found) return found.value
  }
  return undefined
}

function parseDeal(item: AvitoItem, priceNote: string): DealType | null {
  const names = (item.breadcrumbs ?? []).map(b => (b.name ?? '').toLowerCase())
  if (item.shortTermRent?.isShortTermRentCategory || names.includes('посуточно') || /в сутки/i.test(priceNote)) return 'rent_daily'
  if (names.includes('снять') || /в месяц/i.test(priceNote)) return 'rent_long'
  if (names.includes('купить')) return 'sale'
  return null
}

/** «3 из 9» → { floor: 3, total: 9 }; «3» → { floor: 3 }. */
function parseFloor(value: string | undefined): { floor?: number, total?: number } {
  if (!value) return {}
  const m = value.match(/(\d+)\s*из\s*(\d+)/i)
  if (m) return { floor: Number(m[1]), total: Number(m[2]) }
  const n = parseNumber(value)
  return n === undefined ? {} : { floor: n }
}

function pickPhotos(item: AvitoItem): ImportedPhoto[] {
  const photos: ImportedPhoto[] = []
  for (const sizes of item.imageUrls ?? []) {
    // Ключи вида «1280x960»: берём крупнейший размер.
    let best: ImportedPhoto | null = null
    for (const [key, url] of Object.entries(sizes)) {
      const m = key.match(/^(\d+)x(\d+)$/)
      if (!m || !/^https:\/\//.test(url)) continue
      const w = Number(m[1])
      const h = Number(m[2])
      if (!best || w * h > (best.w ?? 0) * (best.h ?? 0)) best = { url, w, h }
    }
    if (best) photos.push(best)
  }
  return photos
}

function categorySlug(item: AvitoItem, buyer: AvitoBuyerItem): string | undefined {
  return item.category?.slug ?? buyer.ga?.find(g => g.categorySlug)?.categorySlug
}

export function normalizeAvito(buyer: AvitoBuyerItem, now = new Date()): ImportedListing {
  const item = buyer.item!
  const warnings: string[] = []
  const params = collectParams(item, buyer)

  const sourceId = String(item.id)
  const sourceUrl = item.seo?.canonicalUrl ?? (item.url ? `https://www.avito.ru${item.url}` : `https://www.avito.ru/${sourceId}`)

  const postfix = decodeEntities(item.formattedPrice?.postfix ?? buyer.normalizedPricePostfix ?? buyer.priceString ?? '')
  const deal = parseDeal(item, postfix)
  const slug = categorySlug(item, buyer)
  const propertyKind = slug ? (CATEGORY_KIND[slug] ?? 'other') : null

  let description: string | undefined
  if (item.description) {
    const fixed = sanitizeDescription(htmlToText(item.description))
    description = fixed.text
    if (fixed.fixed) warnings.push('description_homoglyphs_fixed')
    if (fixed.phones) warnings.push('description_phone_removed')
  }

  // Площади и этажность — из параметров по подписям
  const total = parseAreaValue(paramByLabel(params, 'Общая площадь', 'Площадь дома', 'Площадь квартиры', 'Площадь', 'Площадь комнаты'))
  const living = parseAreaValue(paramByLabel(params, 'Жилая площадь'))
  const kitchen = parseAreaValue(paramByLabel(params, 'Площадь кухни'))
  const plot = parseAreaValue(paramByLabel(params, 'Площадь участка'))
  const floors = parseFloor(paramByLabel(params, 'Этаж'))
  const floorsTotal = floors.total ?? parseNumber(paramByLabel(params, 'Этажей в доме', 'Этажность', 'Количество этажей'))
  // Участок: «Площадь участка»; у категории «Земельные участки» это общая «Площадь» в сотках.
  const landSotka = plot.sotka ?? (plot.sqm !== undefined ? plot.sqm / 100 : total.sotka)
  const rooms = parseNumber(paramByLabel(params, 'Количество комнат'))
  const buildYear = parseNumber(paramByLabel(params, 'Год постройки', 'Год постройки дома'))

  const area: NonNullable<ImportedListing['area']> = {}
  if (total.sqm !== undefined) area.total = total.sqm
  if (living.sqm !== undefined) area.living = living.sqm
  if (kitchen.sqm !== undefined) area.kitchen = kitchen.sqm
  if (landSotka !== undefined) area.landSotka = landSotka

  const addressRaw = item.geo?.address ?? item.address
  const lat = item.geo?.coords?.lat
  const lng = item.geo?.coords?.lng

  const listing: ImportedListing = {
    schema: LISTING_SCHEMA_VERSION,
    source: 'avito',
    sourceId,
    sourceUrl,
    adapterVersion: AVITO_ADAPTER_VERSION,
    fetchedAt: now.toISOString(),
    partial: false,
    deal,
    category: {
      sourceId: item.category?.id ?? item.categoryId,
      path: (item.breadcrumbs ?? []).map(b => cleanText(b.name ?? '')).filter(n => n && n !== 'Главная'),
    },
    propertyKind,
    params,
    photos: pickPhotos(item),
    warnings,
  }

  if (item.title) listing.title = cleanText(item.title)
  if (description) listing.description = description
  if (typeof item.price === 'number') {
    listing.price = { value: item.price, currency: 'RUB' }
    if (deal === 'rent_long') listing.price.period = 'month'
    else if (deal === 'rent_daily') listing.price.period = 'day'
    if (item.formattedPrice?.currencySign && item.formattedPrice.currencySign !== '₽') warnings.push('price_currency_unknown')
  }
  if (addressRaw) {
    listing.address = { raw: cleanText(addressRaw) }
    if (typeof lat === 'number' && typeof lng === 'number') {
      listing.address.lat = lat
      listing.address.lng = lng
    }
  }
  if (Object.keys(area).length) listing.area = area
  if (rooms !== undefined) listing.rooms = rooms
  if (floors.floor !== undefined) listing.floor = floors.floor
  if (floorsTotal !== undefined) listing.floorsTotal = floorsTotal
  if (buildYear !== undefined) listing.buildYear = buildYear

  if (!params.length) warnings.push('no_params')
  if (!listing.price) warnings.push('no_price')
  if (!listing.address) warnings.push('no_address')
  if (!listing.photos.length) warnings.push('no_photos')
  if (deal === null) warnings.push('deal_unknown')
  if (propertyKind === null) warnings.push('kind_unknown')
  listing.partial = warnings.some(w => ['no_params', 'no_price', 'no_address', 'deal_unknown', 'kind_unknown'].includes(w))

  return listing
}
