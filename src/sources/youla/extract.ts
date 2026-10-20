/**
 * Извлечение данных объявления из HTML страницы Юлы.
 *
 * Состояние страницы — `window.__YOULA_STATE__ = {...}` (JSON): `entities.products[]` (объявление),
 * `entities.cities[]` (названия городов по id), `entities.fields[].subfields[]` (определения полей:
 * подпись, единица, множитель `floatFactor`). Серверная разметка характеристик не содержит — только состояние.
 */
import { sliceBalanced } from '../../shared/json-scan'
import { parseJsObject } from '../../shared/js-object'

const MARKER = /window\.__YOULA_STATE__\s*=\s*/

export interface YoulaAttribute {
  slug?: string
  rawValue?: string | null
  values?: { value?: string | null }[]
}

export interface YoulaProduct {
  id?: string
  name?: string
  description?: string
  /** В копейках */
  price?: number
  discountedPrice?: number
  isPublished?: boolean
  isSold?: boolean
  isArchived?: boolean
  isDeleted?: boolean
  isBlocked?: boolean
  images?: { url?: string, num?: number, width?: number | null, height?: number | null }[]
  location?: {
    latitude?: number | null
    longitude?: number | null
    city?: string | null
    address?: string | null
    manualAddress?: string | null
  }
  attributes?: YoulaAttribute[]
}

export interface YoulaFieldDef {
  slug?: string | null
  title?: string | null
  type?: string | null
  params?: { unit?: string | null, floatFactor?: number | null }
}

export interface YoulaCity {
  id?: string
  name?: string
}

export interface YoulaOffer {
  product: YoulaProduct
  cities: YoulaCity[]
  fields: YoulaFieldDef[]
}

export type YoulaExtractResult =
  | { kind: 'ok', offer: YoulaOffer }
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

const BLOCK_MARKERS = [/captcha-container|g-recaptcha|smartcaptcha/i, /Доступ ограничен/i, /Подтвердите, что вы не робот/i, /Проверка безопасности/i]

interface YoulaState {
  template?: { 'app-classified'?: { productId?: string } }
  entities?: { products?: YoulaProduct[], cities?: YoulaCity[], fields?: { subfields?: YoulaFieldDef[] }[] }
}

export function extractState(html: string): YoulaState | null {
  const m = MARKER.exec(html)
  if (!m) return null
  const literal = sliceBalanced(html, m.index + m[0].length)
  if (!literal) return null
  const state = parseJsObject(literal)
  return state && typeof state === 'object' ? state as YoulaState : null
}

export function extractOffer(html: string, status = 200): YoulaExtractResult {
  if (status === 404 || status === 410) return { kind: 'not_found' }

  const state = extractState(html)
  const products = state?.entities?.products ?? []
  // Страница объявления знает свой id; без него берём единственный товар в состоянии
  const wanted = state?.template?.['app-classified']?.productId
  const product = (wanted ? products.find(p => p.id === wanted) : undefined) ?? (products.length === 1 ? products[0] : undefined)

  if (product?.id) {
    if (product.isSold || product.isArchived || product.isDeleted || product.isBlocked || product.isPublished === false) {
      return { kind: 'not_found' }
    }
    return {
      kind: 'ok',
      offer: {
        product,
        cities: state?.entities?.cities ?? [],
        fields: (state?.entities?.fields ?? []).flatMap(f => f.subfields ?? []),
      },
    }
  }

  if (status === 429 || status === 403 || BLOCK_MARKERS.some(re => re.test(html))) return { kind: 'blocked' }
  return { kind: 'unknown' }
}
