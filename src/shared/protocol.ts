/**
 * Общий контракт расширения и платформы.
 * Копия типов лежит в монорепо: apps/web/app/types/listingImport.ts (держать PROTOCOL_VERSION одинаковым).
 */
export const PROTOCOL_VERSION = 1
export const LISTING_SCHEMA_VERSION = 1
export const BRIDGE_CHANNEL = 'etown-ext'

export type SourceId = 'avito' | 'cian' | 'domclick' | 'yandex-realty' | 'youla'

export type DealType = 'sale' | 'rent_long' | 'rent_daily'
export type PropertyKind = 'flat' | 'house' | 'room' | 'land' | 'commercial' | 'garage' | 'other'

export interface ImportedPhoto {
  url: string
  w?: number
  h?: number
}

export interface ImportedParam {
  key: string
  label: string
  value: string
}

export interface ImportedListing {
  schema: typeof LISTING_SCHEMA_VERSION
  source: SourceId
  sourceId: string
  sourceUrl: string
  adapterVersion: number
  fetchedAt: string
  /** true — часть полей не распознана, платформа предупреждает пользователя */
  partial: boolean
  deal: DealType | null
  category: { sourceId?: number | string, path: string[] }
  propertyKind: PropertyKind | null
  price?: { value: number, currency: 'RUB', period?: 'month' | 'day' }
  title?: string
  /** чистый текст после normalize (гомоглифы приведены к кириллице) */
  description?: string
  address?: { raw: string, lat?: number, lng?: number }
  /** м²; площадь участка — в сотках отдельно */
  area?: { total?: number, living?: number, kitchen?: number, landSotka?: number }
  rooms?: number
  floor?: number
  floorsTotal?: number
  buildYear?: number
  /** всё, что не легло в типизированные поля */
  params: ImportedParam[]
  photos: ImportedPhoto[]
  warnings: string[]
}

export type ImportErrorCode =
  | 'unsupported_url'
  | 'captcha_required'
  | 'blocked'
  | 'not_found'
  | 'parse_failed'
  | 'permission_denied'
  | 'rate_limited'
  | 'busy'
  | 'cancelled'
  | 'not_implemented'

// ---- Сообщения моста (страница платформы <-> content script) ----

interface Envelope {
  channel: typeof BRIDGE_CHANNEL
  protocol: number
}

export type PageToExt = Envelope & { dir: 'to-ext' } & (
  | { type: 'hello', requestId: string }
  | { type: 'import', requestId: string, url: string }
  | { type: 'cancel', requestId: string }
)

export type ExtToPage = Envelope & { dir: 'to-page' } & (
  | { type: 'hello_ok', requestId: string, version: string, sources: { id: SourceId, label: string }[] }
  | { type: 'progress', requestId: string, stage: 'matching' | 'loading' | 'parsing' | 'waiting_captcha' }
  | { type: 'result', requestId: string, listing: ImportedListing }
  | { type: 'error', requestId: string, code: ImportErrorCode, message?: string }
)

/** Атрибут на <html>, который ставит content script на подключённых доменах (детект расширения). */
export const DETECT_ATTRIBUTE = 'data-etown-ext'

/** Содержимое /.well-known/etown-extension.json на домене платформы. */
export interface PlatformManifest {
  platform: 'etown'
  protocol: number
}
