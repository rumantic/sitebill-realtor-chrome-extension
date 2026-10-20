import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractOffer, extractState, type YoulaOffer } from '../src/sources/youla/extract'
import { dealFromSubcategory, formatFieldValue, kindFromSubcategory, normalizeYoula } from '../src/sources/youla/normalize'
import { youla } from '../src/sources/youla'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/youla/${name}`, import.meta.url), 'utf8')

function offer(): YoulaOffer {
  const r = extractOffer(fixture('house-sale.html'))
  if (r.kind !== 'ok') throw new Error(`extract: ${r.kind}`)
  return r.offer
}

describe('youla: продажа дома (реальные атрибуты, обезличено)', () => {
  const l = normalizeYoula(offer(), new Date('2026-10-20T10:00:00Z'))

  it('основные поля', () => {
    expect(l.source).toBe('youla')
    expect(l.sourceId).toBe('0123456789abcdef01234567')
    expect(l.deal).toBe('sale')
    expect(l.propertyKind).toBe('house')
    expect(l.partial).toBe(false)
  })

  it('цена переводится из копеек', () => {
    expect(l.price).toEqual({ value: 24000000, currency: 'RUB' })
  })

  it('площади: множитель floatFactor из определения поля («1870» → 187 м², «78» → 7,8 сот.)', () => {
    expect(l.area).toEqual({ total: 187, landSotka: 7.8 })
    expect(l.params.find(p => p.label === 'Площадь дома')?.value).toBe('187 м²')
    expect(l.params.find(p => p.label === 'Площадь участка')?.value).toBe('7.8 сот.')
    expect(l.title).toBe('Дом, 187 м², участок 7,8 сот.')
  })

  it('этажность и характеристики с подписями', () => {
    expect(l.floorsTotal).toBe(3)
    const by = Object.fromEntries(l.params.map(p => [p.label, p.value]))
    expect(by['Материал стен']).toBe('Деревянный')
    expect(by['Количество спален']).toBe('5')
    expect(by['Отопление']).toBe('Автономное')
    expect(by['Газ']).toBe('Подведен')
    expect(by['Водоснабжение и канализация']).toBe('Централизованное')
  })

  it('служебные поля и сведения о продавце не переносятся', () => {
    const labels = l.params.map(p => p.label)
    expect(labels).not.toContain('Кто разместил')
    expect(l.params.some(p => ['category', 'subcategory', 'realty_hidden_location', 'zarplata', 'let_v_sobstvennosti', 'sobstvennik_ili_agent'].includes(p.key))).toBe(false)
  })

  it('адрес: город из справочника страницы + координаты', () => {
    expect(l.address).toEqual({ raw: 'Старая Купавна', lat: 55.78, lng: 38.24 })
  })

  it('фото по порядку, с размерами', () => {
    expect(l.photos).toEqual([1, 2, 3].map(n => ({ url: `https://cdn1.youla.io/files/images/orig/fx/0${n}/fixture${n}-2.jpg`, w: 3000 + n, h: 2000 + n })))
  })

  it('телефон из описания удалён, гомоглифы исправлены', () => {
    expect(l.description).toBe('Продам дом в коттеджном посёлке.\nСауна, тёплые полы, сухой подвал.\n\nПредлагаю обмен. Звоните или пишите.\nСобственник')
    expect(l.warnings).toContain('description_phone_removed')
    expect(l.warnings).toContain('description_homoglyphs_fixed')
    expect(JSON.stringify(l)).not.toMatch(/8\/900|9000000/)
  })

  it('сведения об аккаунте сохранившего страницу в результат не попадают', () => {
    expect(JSON.stringify(l)).not.toMatch(/"ip"|85\.175/)
  })
})

describe('youla: выбор объявления и ошибки', () => {
  it('из нескольких товаров в состоянии берётся тот, что указан в template', () => {
    expect(offer().product.id).toBe('0123456789abcdef01234567')
  })

  it('состояние читается JSON-парсером из окружающего JS', () => {
    expect(extractState(fixture('house-sale.html'))?.entities?.products).toHaveLength(2)
  })

  it('пустая страница → unknown, 404 → not_found, 403/429 → blocked', () => {
    expect(extractOffer('<html></html>').kind).toBe('unknown')
    expect(extractOffer('', 404).kind).toBe('not_found')
    expect(extractOffer('<html></html>', 403).kind).toBe('blocked')
    expect(extractOffer('<html></html>', 429).kind).toBe('blocked')
    expect(extractOffer('<html><body>Подтвердите, что вы не робот</body></html>').kind).toBe('blocked')
  })

  it.each(['isSold', 'isArchived', 'isDeleted', 'isBlocked'])('%s → not_found', (flag) => {
    const html = fixture('house-sale.html').replace(`"${flag}":false`, `"${flag}":true`)
    expect(extractOffer(html).kind).toBe('not_found')
  })

  it('не опубликовано → not_found', () => {
    expect(extractOffer(fixture('house-sale.html').replace('"isPublished":true,"isSold"', '"isPublished":false,"isSold"')).kind).toBe('not_found')
  })

  it('адаптер: parseHtml и matchUrl', () => {
    expect(youla.parseHtml!(fixture('house-sale.html')).sourceId).toBe('0123456789abcdef01234567')
    expect(youla.matchUrl(new URL('https://youla.ru/all/nedvijimost/prodaja-doma/dom-187-m2-0123456789abcdef01234567'))?.sourceId).toBe('0123456789abcdef01234567')
    expect(youla.matchUrl(new URL('https://youla.ru/krasnodar/nedvijimost/prodaja-doma'))).toBeNull()
    expect(youla.matchUrl(new URL('https://youla.ru/all/nedvijimost/prodaja-doma/dom-1'))).toBeNull()
  })
})

describe('youla: логика без реальных страниц других разделов', () => {
  it.each([
    ['Продажа дома', 'sale', 'house'],
    ['Продажа квартиры', 'sale', 'flat'],
    ['Аренда квартиры', 'rent_long', 'flat'],
    ['Посуточная аренда квартир', 'rent_daily', 'flat'],
    ['Продажа комнаты', 'sale', 'room'],
    ['Продажа земельного участка', 'sale', 'land'],
    ['Аренда гаража', 'rent_long', 'garage'],
    ['Продажа коммерческой недвижимости', 'sale', 'commercial'],
    ['Что-то иное', null, 'other'],
  ])('«%s» → %s / %s', (text, deal, kind) => {
    expect(dealFromSubcategory(text)).toBe(deal)
    expect(kindFromSubcategory(text)).toBe(kind)
  })

  it.each([
    ['1870', { params: { unit: 'м²', floatFactor: 10 } }, '187 м²'],
    ['78', { params: { unit: 'сот.', floatFactor: 10 } }, '7.8 сот.'],
    ['1855', { params: { unit: 'м²', floatFactor: 10 } }, '185.5 м²'],
    ['5', { params: { unit: null, floatFactor: null } }, '5'],
    ['Кирпичный', { params: { unit: null, floatFactor: 10 } }, 'Кирпичный'],
    ['12', undefined, '12'],
  ])('значение %s при определении %j → %s', (raw, def, expected) => {
    expect(formatFieldValue(raw, def)).toBe(expected)
  })

  it('поле без подписи нигде (ни на странице, ни в словаре) пропускается с предупреждением, а не выдумывается', () => {
    const base = offer()
    const l = normalizeYoula({
      ...base,
      product: { ...base.product, attributes: [...(base.product.attributes ?? []), { slug: 'neizvestnoe_pole', rawValue: 'x', values: [{ value: 'x' }] }] },
    })
    expect(l.warnings).toContain('attributes_skipped')
    expect(l.params.some(p => p.key === 'neizvestnoe_pole')).toBe(false)
  })

  it('аренда: цена за месяц; скидка — берётся актуальная цена', () => {
    const l = normalizeYoula({
      cities: [], fields: [],
      product: {
        id: 'a'.repeat(24), name: 'Квартира', price: 6000000, discountedPrice: 5500000,
        attributes: [{ slug: 'subcategory', rawValue: 'Аренда квартиры' }],
      },
    })
    expect(l.deal).toBe('rent_long')
    expect(l.price).toEqual({ value: 55000, currency: 'RUB', period: 'month' })
  })
})
