/**
 * Извлечение данных объявления из HTML страницы Яндекс.Недвижимости.
 *
 * JSON с данными объявления на странице нет. Берём:
 *  - `ld+json` Product: id (sku), цена, категория, фото, доступность;
 *  - `ld+json` BreadcrumbList: сделка и тип по адресу раздела (/kupit/kvartira/…);
 *  - серверную разметку карточки: характеристики (OfferCardHighlight, OfferCardFeature), адрес и координаты
 *    (CardLocation), описание (OfferCardTextDescription), слайды галереи (GalleryV2Slide).
 * Классы CSS-модульные с хешем сборки, поэтому ищем по стабильному префиксу (см. shared/html.ts).
 */
import { attr, findByClass, readJsonLd, stripNoise, textOf } from '../../shared/html'

export interface YandexProduct {
  category?: string
  name?: string
  sku?: string
  image?: string[]
  offers?: { price?: number, priceCurrency?: string, availability?: string }
}

export interface YandexRaw {
  product: YandexProduct
  /** Имя страницы (<title>) — по нему определяем сделку и число комнат */
  title: string
  breadcrumbUrls: string[]
  highlights: { value: string, label: string }[]
  features: string[]
  address?: string
  lat?: number
  lng?: number
  description?: string
  galleryUrls: string[]
}

export type YandexExtractResult =
  | { kind: 'ok', raw: YandexRaw }
  | { kind: 'blocked' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

const BLOCK_MARKERS = [/showcaptcha/i, /SmartCaptcha/i, /Подтвердите, что запросы отправляли вы/i, /Вы не робот\?/i]
const GONE_MARKERS = [/Объявление не найдено/i, /снято с публикации/i, /Такого объявления нет/i]

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : x ? [x] : []
}

function ldOfType(blocks: unknown[], type: string): Record<string, any> | undefined {
  return blocks.flatMap(asArray).find((b): b is Record<string, any> => !!b && typeof b === 'object' && (b as any)['@type'] === type)
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** Ссылка из схемы вида `//avatars…` → https. */
export function absolutize(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

export function extractOffer(html: string, status = 200): YandexExtractResult {
  if (status === 404 || status === 410) return { kind: 'not_found' }

  const ld = readJsonLd(html)
  const product = ldOfType(ld, 'Product') as YandexProduct | undefined

  if (!product?.sku) {
    if (status === 429 || status === 403 || BLOCK_MARKERS.some(re => re.test(html))) return { kind: 'blocked' }
    if (GONE_MARKERS.some(re => re.test(html))) return { kind: 'not_found' }
    return { kind: 'unknown' }
  }
  // Снятое объявление страница ещё может отдавать — но уже без наличия
  if (product.offers?.availability && !/InStock/i.test(product.offers.availability)) return { kind: 'not_found' }

  const body = stripNoise(html)

  const breadcrumbs = ldOfType(ld, 'BreadcrumbList')
  const breadcrumbUrls = asArray(breadcrumbs?.itemListElement)
    .map(i => (i as any)?.item?.['@id'])
    .filter((u): u is string => typeof u === 'string')

  const highlights = findByClass(body, 'OfferCardHighlight__container').map(c => ({
    value: textOf(findByClass(c.inner, 'OfferCardHighlight__value')[0]?.inner ?? ''),
    label: textOf(findByClass(c.inner, 'OfferCardHighlight__label')[0]?.inner ?? ''),
  })).filter(h => h.value)

  const features = findByClass(body, 'OfferCardFeature__text').map(e => textOf(e.inner)).filter(Boolean)

  const location = findByClass(body, 'CardLocation__root')[0]
  const address = textOf(findByClass(body, 'CardLocation__addressItem')[0]?.inner ?? '') || undefined

  const description = textOf(findByClass(body, 'OfferCardTextDescription__text')[0]?.inner ?? '') || undefined

  // Слайды галереи: preview-копии дублируют те же data-image-src
  const gallery: string[] = []
  for (const img of findByClass(body, 'GalleryV2Slide__wrappedImage')) {
    const src = attr(img.attrs, 'data-image-src')
    if (src && !gallery.includes(src)) gallery.push(src)
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  return {
    kind: 'ok',
    raw: {
      product,
      title: textOf(title ?? product.name ?? ''),
      breadcrumbUrls,
      highlights,
      features,
      address,
      lat: num(attr(location?.attrs ?? '', 'data-latitude')),
      // «longtitude» (с опечаткой) — так называется атрибут в разметке Яндекса
      lng: num(attr(location?.attrs ?? '', 'data-longtitude')),
      description,
      galleryUrls: gallery.map(absolutize),
    },
  }
}
