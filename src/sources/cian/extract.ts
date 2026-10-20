/**
 * Извлечение данных объявления из HTML страницы ЦИАН.
 *
 * Данные лежат в `window._cianConfig['frontend-offer-card'] = (...).concat([{key, value}, ...])`; запись с
 * key = "defaultState" содержит `offerData` (offer, features, pageHelmetData и т.д.). Это обычный JS-массив
 * с JSON внутри — без eval вырезаем его сбалансированным сканированием и разбираем JSON.parse.
 */
import { sliceBalanced } from '../../shared/json-scan'

const MARKER = /window\._cianConfig\[['"]frontend-offer-card['"]\]\s*=\s*\(window\._cianConfig\[['"]frontend-offer-card['"]\]\s*\|\|\s*\[\]\)\.concat\(/

export interface CianGeoPart {
  fullName?: string
  shortName?: string
  type?: string
}

export interface CianOffer {
  id?: number
  status?: string
  category?: string
  dealType?: string
  offerType?: string
  flatType?: string
  description?: string
  totalArea?: string | number
  kitchenArea?: string | number
  livingArea?: string | number
  roomsCount?: number | null
  floorNumber?: number | null
  priceTotal?: number
  priceTotalRur?: number
  bargainTerms?: { price?: number, currency?: string }
  building?: { floorsCount?: number, buildYear?: number }
  land?: { area?: string | number, areaUnitType?: string }
  geo?: {
    address?: CianGeoPart[]
    coordinates?: { lat?: number, lng?: number }
  }
  photos?: { fullUrl?: string, isCianLayout?: boolean }[]
  newbuilding?: { name?: string, house?: { name?: string } }
  flags?: { isArchived?: boolean }
}

export interface CianFeatureGroup {
  id?: string
  title?: string
  features?: { label?: string, value?: string }[]
}

export interface CianOfferData {
  offer?: CianOffer
  features?: CianFeatureGroup[]
  pageHelmetData?: { canonical?: string }
}

export type CianExtractResult =
  | { kind: 'ok', offerData: CianOfferData }
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

export function extractDefaultState(html: string): { offerData?: CianOfferData } | null {
  const m = MARKER.exec(html)
  if (!m) return null
  const json = sliceBalanced(html, m.index + m[0].length)
  if (!json) return null
  try {
    const entries = JSON.parse(json) as { key?: string, value?: { offerData?: CianOfferData } }[]
    return entries.find(e => e.key === 'defaultState')?.value ?? null
  }
  catch {
    return null
  }
}

const BLOCK_MARKERS = [/captcha/i, /Подтвердите, что вы не робот/i, /Доступ ограничен/i, /Проверка безопасности/i]

export function extractOffer(html: string, status = 200): CianExtractResult {
  if (status === 404 || status === 410) return { kind: 'not_found' }

  const offerData = extractDefaultState(html)?.offerData
  if (offerData?.offer?.id) {
    const o = offerData.offer
    // Снятые с публикации и архивные объявления в карточке ещё открываются, но импортировать их не нужно
    if ((o.status && o.status !== 'published') || o.flags?.isArchived) return { kind: 'not_found' }
    return { kind: 'ok', offerData }
  }

  if (status === 429 || status === 403 || BLOCK_MARKERS.some(re => re.test(html))) return { kind: 'blocked' }
  return { kind: 'unknown' }
}
