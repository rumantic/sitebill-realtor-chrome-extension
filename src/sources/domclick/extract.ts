/**
 * Извлечение данных объявления из HTML страницы Домклик.
 *
 * Состояние страницы лежит в `window.__SSR_STATE__={...}` (JS-литерал: внутри `undefined`, `/`).
 * Объявление — `productCard`: в нём и нормализованные поля (objectInfo, priceInfo, house, address, photos),
 * и сырой ответ API (`originalProduct`, snake_case). Берём нормализованные.
 */
import { sliceBalanced } from '../../shared/json-scan'
import { parseJsObject } from '../../shared/js-object'

const MARKER = /window\.__SSR_STATE__\s*=\s*/

export interface DomclickCard {
  id?: number | string
  _error?: unknown
  _deal?: string
  _type?: string
  dealType?: string
  offerType?: string
  href?: string
  status?: number
  photos?: { url?: string, isPlan?: boolean }[]
  address?: {
    displayName?: string
    position?: { lat?: number, lon?: number }
  }
  objectInfo?: {
    area?: number | null
    livingArea?: number | null
    kitchenArea?: number | null
    roomsArea?: (number | string)[]
    rooms?: number | null
    floor?: number | null
    loggias?: number | null
    balconies?: number | null
    separatedBathrooms?: number | null
    connectedBathrooms?: number | null
    renovation?: string | null
    decoration?: string | null
    windowView?: string[]
    description?: string | null
    buildingClass?: string | null
    buildingName?: string | null
    isApartment?: boolean
  }
  priceInfo?: {
    price?: number | null
    currency?: string | null
    soldPrice?: number | null
    deposit?: number | null
    commission?: number | null
    commissionTypeField?: string | null
    communalPayments?: string | null
    prepaymentMonths?: number | null
  }
  house?: {
    info?: {
      buildYear?: number | null
      ceilingHeight?: number | string | null
      floors?: number | null
      wallType?: string | null
      liftsPassenger?: number | null
      liftsFreight?: number | null
      hasGarbageDisposer?: boolean
      parking?: string[]
      security?: string[]
      infrastructure?: string[]
    }
  }
  land?: { area?: number | string | null, areaUnit?: string | null }
  rent?: { canSmoke?: boolean | null, withAnimals?: boolean | null, withChildren?: boolean | null, amenities?: string[] }
  legalOptions?: { saleType?: string | null }
  flatComplex?: { name?: string | null }
  originalProduct?: { description?: string | null }
}

export type DomclickExtractResult =
  | { kind: 'ok', card: DomclickCard }
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

const BLOCK_MARKERS = [/captcha/i, /Доступ ограничен/i, /Подтвердите, что вы не робот/i, /Проверка безопасности/i, /qrator/i]

export function extractState(html: string): { productCard?: DomclickCard } | null {
  const m = MARKER.exec(html)
  if (!m) return null
  const literal = sliceBalanced(html, m.index + m[0].length)
  if (!literal) return null
  const state = parseJsObject(literal)
  return state && typeof state === 'object' ? state as { productCard?: DomclickCard } : null
}

export function extractOffer(html: string, status = 200): DomclickExtractResult {
  if (status === 404 || status === 410) return { kind: 'not_found' }

  const card = extractState(html)?.productCard
  if (card?.id) {
    // Ошибка загрузки карточки или объявление уже продано
    if (card._error || card.priceInfo?.soldPrice) return { kind: 'not_found' }
    return { kind: 'ok', card }
  }

  if (status === 429 || status === 403 || status === 401 || BLOCK_MARKERS.some(re => re.test(html))) return { kind: 'blocked' }
  return { kind: 'unknown' }
}
