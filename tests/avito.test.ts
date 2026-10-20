import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractHydration, extractListing } from '../src/sources/avito/extract'
import { normalizeAvito } from '../src/sources/avito/normalize'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/avito/${name}`, import.meta.url), 'utf8')

function parse(name: string) {
  const r = extractListing(fixture(name))
  if (r.kind !== 'ok') throw new Error(`extract: ${r.kind}`)
  return normalizeAvito(r.buyerItem, new Date('2026-10-20T10:00:00Z'))
}

describe('avito: продажа дома', () => {
  const l = parse('house-sale.html')

  it('основные поля', () => {
    expect(l.source).toBe('avito')
    expect(l.sourceId).toBe('1000000001')
    expect(l.sourceUrl).toBe('https://www.avito.ru/sochi/doma_dachi_kottedzhi/dom_1462_m_na_uchastke_44_sot._1000000001')
    expect(l.deal).toBe('sale')
    expect(l.propertyKind).toBe('house')
    expect(l.title).toBe('Дом 146,2 м² на участке 4,4 сот.')
    expect(l.price).toEqual({ value: 29500000, currency: 'RUB' })
    expect(l.partial).toBe(false)
  })

  it('характеристики → типизированные поля', () => {
    expect(l.rooms).toBe(5)
    expect(l.floorsTotal).toBe(2)
    expect(l.buildYear).toBe(2018)
    expect(l.area).toEqual({ total: 146.2, landSotka: 4.4 })
  })

  it('все характеристики сохранены как params', () => {
    const labels = l.params.map(p => p.label)
    expect(labels).toContain('Материал стен')
    expect(l.params.find(p => p.label === 'Материал стен')?.value).toBe('кирпич')
  })

  it('адрес и координаты', () => {
    expect(l.address?.raw).toContain('Сочи')
    expect(l.address?.lat).toBeTypeOf('number')
  })

  it('фото — крупнейший размер', () => {
    expect(l.photos).toHaveLength(2)
    expect(l.photos[0]).toMatchObject({ w: 1280, h: 960 })
  })

  it('описание очищено от тегов и гомоглифов', () => {
    expect(l.description).not.toMatch(/<[^>]+>/)
    expect(l.description).not.toMatch(/[A-Za-z]/)
    expect(l.warnings).toContain('description_homoglyphs_fixed')
  })

  it('путь категории без «Главная»', () => {
    expect(l.category.path).toEqual(['Недвижимость', 'Дома, дачи, коттеджи', 'Купить', 'Дома'])
  })
})

describe('avito: долгосрочная аренда дома', () => {
  const l = parse('house-rent.html')

  it('сделка, цена за месяц', () => {
    expect(l.deal).toBe('rent_long')
    expect(l.price).toEqual({ value: 50000, currency: 'RUB', period: 'month' })
  })

  it('те же характеристики при других attributeId', () => {
    expect(l.area).toEqual({ total: 90, landSotka: 10 })
    expect(l.rooms).toBe(3)
    expect(l.buildYear).toBe(2020)
  })

  it('условия аренды и правила попадают в params', () => {
    expect(l.params.find(p => p.label === 'Залог')?.value).toBe('50000 ₽')
    expect(l.params.some(p => p.label === 'Можно с детьми')).toBe(true)
  })
})

describe('avito: устойчивость разбора', () => {
  it('JS-литерал с \\u-экранированием и \\x разбирается', () => {
    const inner = JSON.stringify({ a: 'Дом <b>' })
    const lit = JSON.stringify(inner).replace(/</g, '\\u003c').replace(/>/g, '\\x3e')
    const html = `<script>window.__staticRouterHydrationData = JSON.parse(${lit});</script>`
    expect(extractHydration(html)).toEqual({ a: 'Дом <b>' })
  })

  it('страница без данных → blocked при капче, unknown иначе', () => {
    expect(extractListing('<html><title>Доступ ограничен: проблема с IP</title></html>', 200).kind).toBe('blocked')
    expect(extractListing('<html></html>', 429).kind).toBe('blocked')
    expect(extractListing('<html><body>hello</body></html>', 200).kind).toBe('unknown')
  })

  it('404 → not_found', () => {
    expect(extractListing('', 404).kind).toBe('not_found')
  })

  it('закрытое объявление → not_found', () => {
    const data = { loaderData: { 'catalog-or-main-or-item': { buyerItem: { item: { id: 1, isClosed: true } } } } }
    const html = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script>`
    expect(extractListing(html).kind).toBe('not_found')
  })
})

describe('avito: настоящая страница-заглушка (проверка безопасности)', () => {
  it('распознаётся как blocked, а не как ошибка разбора', () => {
    expect(extractListing(fixture('blocked.html'), 200).kind).toBe('blocked')
    expect(extractListing(fixture('blocked.html'), 439).kind).toBe('blocked')
  })
})
