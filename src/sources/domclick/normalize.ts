import {
  LISTING_SCHEMA_VERSION,
  type DealType,
  type ImportedListing,
  type ImportedParam,
  type PropertyKind,
} from '../../shared/protocol'
import { cleanText, sanitizeDescription, parseNumber } from '../../shared/text'
import { buildTitle } from '../../shared/title'
import type { DomclickCard } from './extract'

export const DOMCLICK_ADAPTER_VERSION = 1

/** Фото лежат на CDN Домклика; в состоянии страницы пути относительные («/vitrina/owner/25/13/….jpg»). */
const IMAGE_HOST = 'https://img.dmclk.ru'

/** Положительное число или undefined: Домклик отдаёт 0 для «не указано» (livingArea, kitchenArea). */
function positive(n: number | string | null | undefined): number | undefined {
  const v = typeof n === 'string' ? parseNumber(n) : n
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

export function dealFromCard(card: DomclickCard): DealType | null {
  const deal = card._deal ?? card.dealType
  if (deal === 'sale') return 'sale'
  if (deal === 'rent') return 'rent_long'
  return null
}

/** Тип объекта из `_type` («flat», «room», «house», …); незнакомое → 'other'. */
export function kindFromCard(card: DomclickCard): PropertyKind | null {
  const type = (card._type ?? card.offerType ?? '').toLowerCase()
  if (!type) return null
  if (/flat|apartment/.test(type)) return 'flat'
  if (/room/.test(type)) return 'room'
  if (/house|cottage|townhouse|dacha|villa/.test(type)) return 'house'
  if (/lot|land|plot|parcel/.test(type)) return 'land'
  if (/garage|parking/.test(type)) return 'garage'
  if (/commerc|office|retail|warehouse|business|industr/.test(type)) return 'commercial'
  return 'other'
}

/** Площадь участка: единицы у Домклика не подтверждены — понимаем сотки, гектары и м², без единицы считаем сотками. */
export function landToSotka(land: DomclickCard['land']): number | undefined {
  const area = positive(land?.area)
  if (area === undefined) return undefined
  const unit = (land?.areaUnit ?? '').toLowerCase()
  if (/га|hect|\bha\b/.test(unit)) return area * 100
  if (/м|m2|sqm|square/.test(unit)) return area / 100
  return area
}

/** Адрес без страны: «Россия, Краснодарский край, Краснодар, улица Мира, 1» → «Краснодарский край, Краснодар, улица Мира, 1». */
export function addressRaw(card: DomclickCard): string | undefined {
  const full = cleanText(card.address?.displayName ?? '')
  if (!full) return undefined
  return full.replace(/^Россия,\s*/i, '') || undefined
}

function pushParam(params: ImportedParam[], label: string, value: string | number | null | undefined) {
  const v = typeof value === 'number' ? String(value) : cleanText(value ?? '')
  if (v && !params.some(p => p.label === label)) params.push({ key: label, label, value: v })
}

const yesNo = (v: boolean | null | undefined) => (v === true ? 'да' : v === false ? 'нет' : undefined)

function buildParams(card: DomclickCard, studio: boolean): ImportedParam[] {
  const params: ImportedParam[] = []
  const info = card.objectInfo
  const house = card.house?.info

  if (studio) pushParam(params, 'Количество комнат', 'студия')
  pushParam(params, 'Ремонт', info?.renovation)
  pushParam(params, 'Отделка', info?.decoration)
  pushParam(params, 'Тип дома', house?.wallType)

  const ceiling = positive(house?.ceilingHeight)
  if (ceiling !== undefined) pushParam(params, 'Высота потолков', `${String(ceiling).replace('.', ',')} м`)

  const baths = [
    info?.separatedBathrooms ? `раздельных ${info.separatedBathrooms}` : '',
    info?.connectedBathrooms ? `совмещённых ${info.connectedBathrooms}` : '',
  ].filter(Boolean).join(', ')
  pushParam(params, 'Санузел', baths)

  const balcony = [
    info?.balconies ? `балконов ${info.balconies}` : '',
    info?.loggias ? `лоджий ${info.loggias}` : '',
  ].filter(Boolean).join(', ')
  pushParam(params, 'Балкон/лоджия', balcony)

  pushParam(params, 'Вид из окон', (info?.windowView ?? []).join(', '))

  const rooms = (info?.roomsArea ?? []).map(a => positive(a)).filter((a): a is number => a !== undefined)
  if (rooms.length > 1) pushParam(params, 'Площадь комнат', rooms.map(a => `${String(a).replace('.', ',')} м²`).join(' '))

  const lifts = [
    house?.liftsPassenger ? `пассажирских ${house.liftsPassenger}` : '',
    house?.liftsFreight ? `грузовых ${house.liftsFreight}` : '',
  ].filter(Boolean).join(', ')
  pushParam(params, 'Лифты', lifts)

  pushParam(params, 'Парковка', (house?.parking ?? []).join(', '))
  pushParam(params, 'Безопасность', (house?.security ?? []).join(', '))
  pushParam(params, 'Инфраструктура', (house?.infrastructure ?? []).join(', '))
  if (house?.hasGarbageDisposer) pushParam(params, 'Мусоропровод', 'есть')

  pushParam(params, 'Класс здания', info?.buildingClass)
  pushParam(params, 'Тип продажи', card.legalOptions?.saleType)

  // ЖК: название комплекса / корпуса
  pushParam(params, 'ЖК', card.flatComplex?.name ?? info?.buildingName)

  // Условия аренды
  const price = card.priceInfo
  if (positive(price?.deposit) !== undefined) pushParam(params, 'Залог', `${price!.deposit} ₽`)
  pushParam(params, 'Комиссия', price?.commissionTypeField)
  pushParam(params, 'Коммунальные платежи', price?.communalPayments)
  if (positive(price?.prepaymentMonths) !== undefined) pushParam(params, 'Предоплата, мес.', price!.prepaymentMonths)
  pushParam(params, 'Можно с детьми', yesNo(card.rent?.withChildren))
  pushParam(params, 'Можно с животными', yesNo(card.rent?.withAnimals))
  pushParam(params, 'Можно курить', yesNo(card.rent?.canSmoke))
  pushParam(params, 'Удобства', (card.rent?.amenities ?? []).join(', '))

  return params
}

export function normalizeDomclick(card: DomclickCard, now = new Date()): ImportedListing {
  const warnings: string[] = []
  const sourceId = String(card.id)
  const deal = dealFromCard(card)
  const kind = kindFromCard(card)
  const info = card.objectInfo

  const rooms = typeof info?.rooms === 'number' ? info.rooms : undefined
  const studio = kind === 'flat' && rooms === 0

  const total = positive(info?.area)
  const living = positive(info?.livingArea)
  const kitchen = positive(info?.kitchenArea)
  const landSotka = landToSotka(card.land)
  const floor = positive(info?.floor)
  const floorsTotal = positive(card.house?.info?.floors)
  const buildYear = positive(card.house?.info?.buildYear)

  const params = buildParams(card, studio)

  const listing: ImportedListing = {
    schema: LISTING_SCHEMA_VERSION,
    source: 'domclick',
    sourceId,
    sourceUrl: card.href ?? `https://domclick.ru/card/${card._deal ?? 'sale'}__${card._type ?? 'flat'}__${sourceId}`,
    adapterVersion: DOMCLICK_ADAPTER_VERSION,
    fetchedAt: now.toISOString(),
    partial: false,
    deal,
    category: { sourceId: card._type, path: [card._deal, card._type].filter((s): s is string => !!s) },
    propertyKind: kind,
    params,
    photos: [],
    warnings,
  }

  const title = buildTitle({ kind, studio, rooms: studio ? undefined : rooms, total, floor, floorsTotal, landSotka })
  if (title) listing.title = title

  const description = info?.description ?? card.originalProduct?.description
  if (description) {
    const fixed = sanitizeDescription(description.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
    listing.description = fixed.text
    if (fixed.fixed) warnings.push('description_homoglyphs_fixed')
    if (fixed.phones) warnings.push('description_phone_removed')
  }

  const price = positive(card.priceInfo?.price)
  if (price !== undefined) {
    listing.price = { value: price, currency: 'RUB' }
    if (deal === 'rent_long') listing.price.period = 'month'
    const currency = card.priceInfo?.currency
    if (currency && !/^(RUB|RUR)$/i.test(currency)) warnings.push('price_currency_unknown')
  }

  const raw = addressRaw(card)
  if (raw) {
    listing.address = { raw }
    const { lat, lon } = card.address?.position ?? {}
    if (typeof lat === 'number' && typeof lon === 'number') {
      listing.address.lat = lat
      listing.address.lng = lon
    }
  }

  // Фото без планировок; пути относительные — достраиваем до CDN
  const seen = new Set<string>()
  for (const p of card.photos ?? []) {
    if (p.isPlan || !p.url) continue
    const url = p.url.startsWith('http') ? p.url : `${IMAGE_HOST}${p.url.startsWith('/') ? '' : '/'}${p.url}`
    if (seen.has(url)) continue
    seen.add(url)
    listing.photos.push({ url })
  }

  const area: NonNullable<ImportedListing['area']> = {}
  if (total !== undefined) area.total = total
  if (living !== undefined) area.living = living
  if (kitchen !== undefined) area.kitchen = kitchen
  if (landSotka !== undefined) area.landSotka = landSotka
  if (Object.keys(area).length) listing.area = area

  if (studio) listing.rooms = 0
  else if (rooms !== undefined && rooms > 0) listing.rooms = rooms
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
