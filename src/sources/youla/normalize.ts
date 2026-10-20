import {
  LISTING_SCHEMA_VERSION,
  type DealType,
  type ImportedListing,
  type ImportedParam,
  type PropertyKind,
} from '../../shared/protocol'
import { cleanText, parseAreaValue, parseNumber, sanitizeDescription } from '../../shared/text'
import { buildTitle } from '../../shared/title'
import type { YoulaFieldDef, YoulaOffer, YoulaProduct } from './extract'

export const YOULA_ADAPTER_VERSION = 1

/**
 * Подписи характеристик, которых нет среди определений полей на странице (свёрнутая группа «Все параметры»).
 * Слаги — транслитерация русских слов, подписи однозначны. Всё, чего здесь нет и что страница не описала, пропускаем
 * (предупреждение `attributes_skipped`), а не придумываем подпись.
 */
const KNOWN_LABELS: Record<string, string> = {
  realty_etajnost_doma: 'Этажей в доме',
  sanuzel: 'Санузел',
  elektrichestvo: 'Электричество',
  gaz: 'Газ',
  otoplenie: 'Отопление',
  vodosnabjenie_i_kanalizaciya: 'Водоснабжение и канализация',
  garaj_mashinomesto: 'Гараж / машиноместо',
  tip_postroyki: 'Тип постройки',
  tip_uchastka: 'Тип участка',
  material_doma: 'Материал стен',
}

/** Служебное и сведения о продавце: не характеристики объекта, в новое объявление не переносим. */
const IGNORED_SLUGS = new Set([
  'category', 'subcategory', 'realty_hidden_location', 'zarplata',
  'let_v_sobstvennosti', 'sobstvennik_ili_agent',
])

/**
 * Раздел Юлы («Продажа дома», «Аренда квартиры», «Посуточная аренда», …) → сделка.
 */
export function dealFromSubcategory(text: string): DealType | null {
  if (/посуточн/i.test(text)) return 'rent_daily'
  if (/аренд|сда[мю]/i.test(text)) return 'rent_long'
  if (/продаж|продам/i.test(text)) return 'sale'
  return null
}

export function kindFromSubcategory(text: string): PropertyKind | null {
  if (!text) return null
  if (/квартир/i.test(text)) return 'flat'
  if (/комнат/i.test(text)) return 'room'
  if (/гараж|машиномест/i.test(text)) return 'garage'
  if (/участк|земл/i.test(text)) return 'land'
  if (/дом|коттедж|дач|таунхаус/i.test(text)) return 'house'
  if (/коммерч|офис|помещени|склад|магазин/i.test(text)) return 'commercial'
  return 'other'
}

/**
 * Значения числовых полей хранятся целыми с множителем (`floatFactor`): «1870» при factor 10 — это 187 м².
 * Множитель и единица берутся из определения поля на странице, а не угадываются.
 */
export function formatFieldValue(raw: string, def: YoulaFieldDef | undefined): string {
  const factor = def?.params?.floatFactor
  const unit = def?.params?.unit
  let value = raw
  if (factor && factor > 0) {
    const n = Number(raw)
    if (Number.isFinite(n)) value = String(Math.round((n / factor) * 1000) / 1000)
  }
  return unit ? `${value} ${unit}` : value
}

function buildParams(product: YoulaProduct, fields: YoulaFieldDef[]): { params: ImportedParam[], skipped: number } {
  const defs = new Map<string, YoulaFieldDef>()
  // Определения с типом-подписью («tag_id») дублируют основные поля без единиц — берём именно поля со значениями
  for (const f of fields) if (f.slug && f.title && f.type !== 'tag_id') defs.set(f.slug, f)

  const params: ImportedParam[] = []
  let skipped = 0
  const seen = new Set<string>()

  for (const attr of product.attributes ?? []) {
    const slug = attr.slug
    if (!slug || IGNORED_SLUGS.has(slug)) continue

    const def = defs.get(slug)
    const label = KNOWN_LABELS[slug] ?? def?.title
    const values = (attr.values ?? []).map(v => cleanText(v.value ?? '')).filter(Boolean)
    const raw = values.length ? values.join(', ') : cleanText(attr.rawValue ?? '')
    if (!raw) continue
    if (!label) {
      skipped++
      continue
    }
    if (seen.has(label)) continue
    seen.add(label)
    // Множитель применяется к одиночному числовому значению
    params.push({ key: slug, label, value: values.length > 1 ? raw : formatFieldValue(raw, def) })
  }
  return { params, skipped }
}

function attributeText(product: YoulaProduct, slug: string): string {
  const a = product.attributes?.find(x => x.slug === slug)
  return cleanText(a?.rawValue ?? a?.values?.[0]?.value ?? '')
}

function paramByLabel(params: ImportedParam[], ...labels: string[]): string | undefined {
  for (const label of labels) {
    const found = params.find(p => p.label.toLowerCase() === label.toLowerCase())
    if (found) return found.value
  }
  return undefined
}

export function normalizeYoula(offer: YoulaOffer, now = new Date()): ImportedListing {
  const { product, cities, fields } = offer
  const warnings: string[] = []
  const sourceId = String(product.id)

  const subcategory = attributeText(product, 'subcategory')
  const deal = dealFromSubcategory(subcategory)
  const kind = kindFromSubcategory(subcategory)

  const { params, skipped } = buildParams(product, fields)
  if (skipped) warnings.push('attributes_skipped')

  const total = parseAreaValue(paramByLabel(params, 'Площадь дома', 'Общая площадь', 'Площадь квартиры', 'Площадь', 'Площадь комнаты'))
  const living = parseAreaValue(paramByLabel(params, 'Жилая площадь'))
  const kitchen = parseAreaValue(paramByLabel(params, 'Площадь кухни'))
  const plot = parseAreaValue(paramByLabel(params, 'Площадь участка'))
  const landSotka = plot.sotka ?? (plot.sqm !== undefined ? plot.sqm / 100 : undefined)
  const floor = parseNumber(paramByLabel(params, 'Этаж'))
  const floorsTotal = parseNumber(paramByLabel(params, 'Этажей в доме', 'Этажность дома'))
  const rooms = parseNumber(paramByLabel(params, 'Количество комнат'))
  const buildYear = parseNumber(paramByLabel(params, 'Год постройки'))

  const listing: ImportedListing = {
    schema: LISTING_SCHEMA_VERSION,
    source: 'youla',
    sourceId,
    sourceUrl: `https://youla.ru/product/${sourceId}`,
    adapterVersion: YOULA_ADAPTER_VERSION,
    fetchedAt: now.toISOString(),
    partial: false,
    deal,
    category: { sourceId: subcategory || undefined, path: ['Недвижимость', subcategory].filter(Boolean) },
    propertyKind: kind,
    params,
    photos: [],
    warnings,
  }

  const title = buildTitle({ kind, studio: false, rooms, total: total.sqm, floor, floorsTotal, landSotka }) ?? cleanText(product.name ?? '')
  if (title) listing.title = title

  if (product.description) {
    const fixed = sanitizeDescription(product.description.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    listing.description = fixed.text
    if (fixed.fixed) warnings.push('description_homoglyphs_fixed')
    if (fixed.phones) warnings.push('description_phone_removed')
  }

  // Цена в копейках; discountedPrice — актуальная цена (со скидкой), price — исходная
  const kopecks = (product.discountedPrice && product.discountedPrice > 0) ? product.discountedPrice : product.price
  if (typeof kopecks === 'number' && kopecks > 0) {
    listing.price = { value: Math.round(kopecks) / 100, currency: 'RUB' }
    if (deal === 'rent_long') listing.price.period = 'month'
    else if (deal === 'rent_daily') listing.price.period = 'day'
  }

  // Адрес: город из справочника страницы + улица/дом, если продавец их не скрыл
  const loc = product.location
  const city = cities.find(c => c.id && c.id === loc?.city)?.name
  const raw = [city, cleanText(loc?.address ?? ''), cleanText(loc?.manualAddress ?? '')].filter(Boolean).join(', ')
  if (raw) {
    listing.address = { raw }
    if (typeof loc?.latitude === 'number' && typeof loc.longitude === 'number') {
      listing.address.lat = loc.latitude
      listing.address.lng = loc.longitude
    }
  }

  const seen = new Set<string>()
  for (const img of [...(product.images ?? [])].sort((a, b) => (a.num ?? 0) - (b.num ?? 0))) {
    if (!img.url || !/^https:\/\//.test(img.url) || seen.has(img.url)) continue
    seen.add(img.url)
    listing.photos.push({ url: img.url, ...(img.width ? { w: img.width } : {}), ...(img.height ? { h: img.height } : {}) })
  }

  const area: NonNullable<ImportedListing['area']> = {}
  if (total.sqm !== undefined) area.total = total.sqm
  if (living.sqm !== undefined) area.living = living.sqm
  if (kitchen.sqm !== undefined) area.kitchen = kitchen.sqm
  if (landSotka !== undefined) area.landSotka = landSotka
  if (Object.keys(area).length) listing.area = area

  if (rooms !== undefined) listing.rooms = rooms
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
