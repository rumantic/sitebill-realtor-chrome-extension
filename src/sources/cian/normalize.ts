import {
  LISTING_SCHEMA_VERSION,
  type DealType,
  type ImportedListing,
  type ImportedParam,
  type ImportedPhoto,
  type PropertyKind,
} from '../../shared/protocol'
import { cleanText, sanitizeDescription, parseNumber } from '../../shared/text'
import { buildTitle } from '../../shared/title'
import type { CianFeatureGroup, CianOffer, CianOfferData } from './extract'

export const CIAN_ADAPTER_VERSION = 1

/** Группы характеристик, которые не переносим: юридические сведения о продавце не нужны новому объявлению. */
const SKIPPED_FEATURE_GROUPS = new Set(['legal'])

/**
 * Категория ЦИАН (flatSale, dailyHouseRent, newBuildingFlatSale, …) → сделка.
 * Посуточная аренда — отдельные категории с префиксом daily.
 */
export function dealFromOffer(offer: CianOffer): DealType | null {
  const category = offer.category ?? ''
  if (/^daily/i.test(category)) return 'rent_daily'
  if (offer.dealType === 'rent' || /Rent$/.test(category)) return 'rent_long'
  if (offer.dealType === 'sale' || /Sale$/.test(category)) return 'sale'
  return null
}

export function kindFromOffer(offer: CianOffer): PropertyKind | null {
  const category = (offer.category ?? '').toLowerCase()
  if (!category && !offer.offerType) return null
  if (category.includes('garage')) return 'garage'
  if (category.includes('land')) return 'land'
  if (offer.offerType === 'commercial') return 'commercial'
  if (/house|cottage|townhouse/.test(category) || offer.offerType === 'suburban') return 'house'
  if (/room|bed/.test(category) && !category.includes('flat')) return 'room'
  if (category.includes('flat') || offer.offerType === 'flat') return 'flat'
  return 'other'
}

function num(v: string | number | null | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  return parseNumber(v)
}

function collectParams(groups: CianFeatureGroup[] | undefined): ImportedParam[] {
  const seen = new Set<string>()
  const out: ImportedParam[] = []
  for (const group of groups ?? []) {
    if (group.id && SKIPPED_FEATURE_GROUPS.has(group.id)) continue
    for (const f of group.features ?? []) {
      const label = cleanText(f.label ?? '')
      const value = cleanText(f.value ?? '')
      if (!label || !value || seen.has(label)) continue
      seen.add(label)
      out.push({ key: `${group.id ?? 'features'}.${label}`, label, value })
    }
  }
  return out
}

function pickPhotos(offer: CianOffer): ImportedPhoto[] {
  const seen = new Set<string>()
  const photos: ImportedPhoto[] = []
  for (const p of offer.photos ?? []) {
    // Планировки ЦИАН (isCianLayout) — не фотографии объекта
    if (p.isCianLayout || !p.fullUrl || !/^https:\/\//.test(p.fullUrl) || seen.has(p.fullUrl)) continue
    seen.add(p.fullUrl)
    photos.push({ url: p.fullUrl })
  }
  return photos
}

/** Адрес из типизированных частей (регион, город, район, микрорайон, улица, дом) полными названиями. */
function addressRaw(offer: CianOffer): string | undefined {
  const parts = (offer.geo?.address ?? []).map(p => cleanText(p.fullName ?? p.shortName ?? '')).filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

export function normalizeCian(data: CianOfferData, now = new Date()): ImportedListing {
  const offer = data.offer!
  const warnings: string[] = []
  const params = collectParams(data.features)

  const deal = dealFromOffer(offer)
  const kind = kindFromOffer(offer)
  const sourceId = String(offer.id)
  const sourceUrl = data.pageHelmetData?.canonical
    ?? `https://www.cian.ru/${offer.dealType === 'rent' ? 'rent' : 'sale'}/${offer.offerType ?? 'flat'}/${sourceId}/`

  const studio = offer.flatType === 'studio'
  const rooms = studio ? 0 : (typeof offer.roomsCount === 'number' ? offer.roomsCount : undefined)
  if (studio) params.unshift({ key: 'rooms', label: 'Количество комнат', value: 'студия' })

  const total = num(offer.totalArea)
  const living = num(offer.livingArea)
  const kitchen = num(offer.kitchenArea)
  // Участок: {area, areaUnitType: 'sotka' | 'hectare'}; без единицы считаем сотками
  const landArea = num(offer.land?.area)
  const landSotka = landArea === undefined ? undefined : (offer.land?.areaUnitType === 'hectare' ? landArea * 100 : landArea)

  const floor = offer.floorNumber ?? undefined
  const floorsTotal = offer.building?.floorsCount
  const buildYear = offer.building?.buildYear

  if (offer.newbuilding?.name) {
    const house = offer.newbuilding.house?.name
    params.push({ key: 'newbuilding', label: 'ЖК', value: house ? `${offer.newbuilding.name}, ${house}` : offer.newbuilding.name })
  }

  const listing: ImportedListing = {
    schema: LISTING_SCHEMA_VERSION,
    source: 'cian',
    sourceId,
    sourceUrl,
    adapterVersion: CIAN_ADAPTER_VERSION,
    fetchedAt: now.toISOString(),
    partial: false,
    deal,
    category: { sourceId: offer.category, path: [offer.dealType, offer.offerType, offer.category].filter((s): s is string => !!s) },
    propertyKind: kind,
    params,
    photos: pickPhotos(offer),
    warnings,
  }

  const title = buildTitle({ kind, studio, rooms, total, floor, floorsTotal, landSotka })
  if (title) listing.title = title

  if (offer.description) {
    const fixed = sanitizeDescription(offer.description.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    listing.description = fixed.text
    if (fixed.fixed) warnings.push('description_homoglyphs_fixed')
    if (fixed.phones) warnings.push('description_phone_removed')
  }

  const priceValue = offer.priceTotalRur ?? (offer.bargainTerms?.currency === 'rur' ? offer.bargainTerms.price : undefined)
  if (typeof priceValue === 'number') {
    listing.price = { value: priceValue, currency: 'RUB' }
    if (deal === 'rent_long') listing.price.period = 'month'
    else if (deal === 'rent_daily') listing.price.period = 'day'
  }
  else if (typeof offer.bargainTerms?.price === 'number') {
    warnings.push('price_currency_unknown')
  }

  const raw = addressRaw(offer)
  if (raw) {
    listing.address = { raw }
    const { lat, lng } = offer.geo?.coordinates ?? {}
    if (typeof lat === 'number' && typeof lng === 'number') {
      listing.address.lat = lat
      listing.address.lng = lng
    }
  }

  const area: NonNullable<ImportedListing['area']> = {}
  if (total !== undefined) area.total = total
  if (living !== undefined) area.living = living
  if (kitchen !== undefined) area.kitchen = kitchen
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
