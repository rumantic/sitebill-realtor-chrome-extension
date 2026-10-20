import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractOffer, type YandexRaw } from '../src/sources/yandex-realty/extract'
import { dealFromRaw, featureToParam, kindFromRaw, normalizeYandexRealty, roomsFromTitle } from '../src/sources/yandex-realty/normalize'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/yandex-realty/${name}`, import.meta.url), 'utf8')

function parse(html = fixture('flat-sale.html')) {
  const r = extractOffer(html)
  if (r.kind !== 'ok') throw new Error(`extract: ${r.kind}`)
  return { raw: r.raw, listing: normalizeYandexRealty(r.raw, new Date('2026-10-20T10:00:00Z')) }
}

describe('yandex-realty: продажа квартиры (реальная страница, обезличена)', () => {
  const { listing: l, raw } = parse()

  it('основные поля', () => {
    expect(l.source).toBe('yandex-realty')
    expect(l.sourceId).toBe('900000000000000001')
    expect(l.sourceUrl).toBe('https://realty.yandex.ru/offer/900000000000000001/')
    expect(l.deal).toBe('sale')
    expect(l.propertyKind).toBe('flat')
    expect(l.price).toEqual({ value: 7300000, currency: 'RUB' })
    expect(l.partial).toBe(false)
  })

  it('площади, комнаты, этажность и год — из плашек и заголовка', () => {
    expect(l.area).toEqual({ total: 65.8, living: 37.1, kitchen: 14.8 })
    expect(l.rooms).toBe(3)
    expect(l.floor).toBe(2)
    expect(l.floorsTotal).toBe(5)
    expect(l.buildYear).toBe(1980)
    expect(l.title).toBe('3-комн. квартира, 65,8 м², 2/5 эт.')
  })

  it('адрес и координаты берутся из блока местоположения', () => {
    expect(l.address).toEqual({ raw: 'Краснодар, улица Тестовая, 1/1', lat: 45.07, lng: 38.98 })
  })

  it('характеристики приведены к подписям маппера платформы', () => {
    const by = Object.fromEntries(l.params.map(p => [p.label, p.value]))
    expect(by['Ремонт']).toBe('косметический ремонт')
    expect(by['Тип дома']).toBe('Кирпичное здание')
    expect(by['Высота потолков']).toBe('2,8 м')
    expect(by['Санузел']).toBe('раздельный')
    expect(by['Площадь комнат']).toBe('12,4 м² 9 м² 15,7 м²')
    expect(by['Лоджия']).toBe('есть')
  })

  it('шум не попадает в параметры: цена за м², дубль потолков, год и этажность дома', () => {
    expect(l.params.some(p => /за м²/.test(p.label))).toBe(false)
    expect(l.params.filter(p => p.label === 'Высота потолков')).toHaveLength(1)
    expect(l.params.some(p => p.label === 'Год постройки' || p.label === 'Этажность дома')).toBe(false)
  })

  it('фото: слайды без дублей preview, в порядке галереи', () => {
    expect(l.photos.map(p => p.url)).toEqual([1, 2, 3].map(n => `https://avatars.mds.yandex.net/get-realty-offers/1/add.fixture${n}.realty-api-vos/app_large`))
  })

  it('описание: переносы, скрытая часть, сущности, гомоглифы', () => {
    expect(l.description).toContain('Я СОБСТВЕННИК\nПродаётся 3‑комнатная квартира')
    expect(l.description).toContain('Просторная квартира & светлая.')
    expect(l.description).toContain('Скрытая по умолчанию часть описания.')
    expect(l.warnings).toContain('description_homoglyphs_fixed')
  })

  it('текст внутри script не принимается за данные страницы', () => {
    expect(raw.highlights.some(h => /ЛОВУШКА/.test(h.value))).toBe(false)
    expect(raw.highlights).toHaveLength(6)
  })
})

describe('yandex-realty: запасные пути', () => {
  it('галерея не отрисована на сервере → одно фото из ld+json (без дублей размеров)', () => {
    const noGallery = fixture('flat-sale.html').replace(/GalleryV2Slide__wrappedImage/g, 'Nope')
    const { listing } = parse(noGallery)
    expect(listing.photos).toEqual([{ url: 'https://avatars.mds.yandex.net/get-realty-offers/1/add.fixture1.realty-api-vos/app_large' }])
  })

  it('нет блока местоположения → предупреждение, partial', () => {
    const { listing } = parse(fixture('flat-sale.html').replace(/CardLocation__addressItem/g, 'Nope'))
    expect(listing.address).toBeUndefined()
    expect(listing.warnings).toContain('no_address')
    expect(listing.partial).toBe(true)
  })
})

describe('yandex-realty: ошибки', () => {
  it('капча → blocked, 404 → not_found, пустая страница → unknown', () => {
    expect(extractOffer('<html><body>Подтвердите, что запросы отправляли вы, а не робот</body></html>').kind).toBe('blocked')
    expect(extractOffer('<html></html>', 429).kind).toBe('blocked')
    expect(extractOffer('', 404).kind).toBe('not_found')
    expect(extractOffer('<html><body>Объявление не найдено</body></html>').kind).toBe('not_found')
    expect(extractOffer('<html></html>').kind).toBe('unknown')
  })

  it('объявление не в наличии → not_found', () => {
    const gone = fixture('flat-sale.html').replace('schema.org/InStock', 'schema.org/OutOfStock')
    expect(extractOffer(gone).kind).toBe('not_found')
  })
})

describe('yandex-realty: сделка, тип, комнаты (логика без реальных страниц этих типов)', () => {
  const raw = (over: Partial<YandexRaw> & { category?: string } = {}): YandexRaw => ({
    product: { category: over.category, sku: '1' },
    title: '', breadcrumbUrls: [], highlights: [], features: [], galleryUrls: [], ...over,
  })

  it.each([
    ['Купить 2-комнатную квартиру', [], 'sale'],
    ['Снять 1-комнатную квартиру', [], 'rent_long'],
    ['Снять квартиру посуточно', [], 'rent_daily'],
    ['', ['https://realty.yandex.ru/moskva/kupit/dom/'], 'sale'],
    ['', ['https://realty.yandex.ru/moskva/snyat/kvartira/'], 'rent_long'],
    ['', ['https://realty.yandex.ru/sochi/snyat/kvartira/posutochno/'], 'rent_daily'],
    ['Что-то иное', [], null],
  ])('%j %j → %s', (title, urls, deal) => {
    expect(dealFromRaw(raw({ title, breadcrumbUrls: urls }))).toBe(deal)
  })

  it.each([
    ['APARTMENT', 'flat'], ['ROOMS', 'room'], ['HOUSE', 'house'], ['LOT', 'land'], ['GARAGE', 'garage'], ['COMMERCIAL', 'commercial'], ['WEIRD', 'other'],
  ])('категория %s → %s', (category, kind) => {
    expect(kindFromRaw(raw({ category }))).toBe(kind)
  })

  it('число комнат и студия по заголовку', () => {
    expect(roomsFromTitle('Купить 3-комнатную квартиру')).toEqual({ rooms: 3, studio: false })
    expect(roomsFromTitle('Купить студию 25 м²')).toEqual({ studio: true })
    expect(roomsFromTitle('Купить дом')).toEqual({ studio: false })
  })

  it('участок и дом: сотки и гектары из плашек', () => {
    const l = normalizeYandexRealty(raw({
      category: 'HOUSE',
      title: 'Купить дом',
      highlights: [{ value: '120 м²', label: 'дом' }, { value: '1,5 га', label: 'участок' }],
    }))
    expect(l.area).toEqual({ total: 120, landSotka: 150 })
    expect(l.title).toBe('Дом, 120 м², участок 150 сот.')
  })
})

describe('featureToParam', () => {
  it.each([
    ['Отделка — евроремонт', 'Ремонт', 'евроремонт'],
    ['Монолитное здание', 'Тип дома', 'Монолитное здание'],
    ['3 м потолки', 'Высота потолков', '3 м'],
    ['Санузел совмещённый', 'Санузел', 'совмещённый'],
    ['Подземная парковка', 'Парковка', 'Подземная парковка'],
    ['Балкон', 'Балкон', 'есть'],
  ])('%s → %s: %s', (text, label, value) => {
    expect(featureToParam(text, 0)).toMatchObject({ label, value })
  })

  it('цена за м² отбрасывается', () => {
    expect(featureToParam('110 942 ₽ за м²', 0)).toBeNull()
  })
})
