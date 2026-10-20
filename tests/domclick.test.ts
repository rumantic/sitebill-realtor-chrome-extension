import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jsObjectToJson, parseJsObject } from '../src/shared/js-object'
import { extractOffer, extractState, type DomclickCard } from '../src/sources/domclick/extract'
import { dealFromCard, kindFromCard, landToSotka, normalizeDomclick } from '../src/sources/domclick/normalize'
import { domclick } from '../src/sources/domclick'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/domclick/${name}`, import.meta.url), 'utf8')

function card(): DomclickCard {
  const c = extractOffer(fixture('flat-sale.html'))
  if (c.kind !== 'ok') throw new Error(`extract: ${c.kind}`)
  return c.card
}

describe('domclick: продажа квартиры (реальная страница, обезличена)', () => {
  const l = normalizeDomclick(card(), new Date('2026-10-20T10:00:00Z'))

  it('основные поля', () => {
    expect(l.source).toBe('domclick')
    expect(l.sourceId).toBe('1000000003')
    expect(l.sourceUrl).toBe('https://domclick.ru/card/sale__flat__1000000003')
    expect(l.deal).toBe('sale')
    expect(l.propertyKind).toBe('flat')
    expect(l.price).toEqual({ value: 18000000, currency: 'RUB' })
    expect(l.partial).toBe(false)
  })

  it('площадь, комнаты, этаж, год; нулевые жилая и кухня считаются «не указано»', () => {
    expect(l.area).toEqual({ total: 38.1 })
    expect(l.rooms).toBe(1)
    expect(l.floor).toBe(9)
    expect(l.floorsTotal).toBe(17)
    expect(l.buildYear).toBe(2001)
    expect(l.title).toBe('1-комн. квартира, 38,1 м², 9/17 эт.')
  })

  it('адрес без страны, координаты из position.lon → lng', () => {
    expect(l.address).toEqual({ raw: 'Москва, Тестовая улица, 1', lat: 55.67, lng: 37.57 })
  })

  it('фото: пути достроены до CDN, планировки исключены', () => {
    expect(l.photos.map(p => p.url)).toEqual([1, 2, 3].map(n => `https://img.dmclk.ru/vitrina/owner/fx/0${n}/fixture${n}.jpg`))
  })

  it('описание: переносы сохранены, лишние пробелы и пустые строки убраны', () => {
    expect(l.description).toBe('Продаётся уютная однокомнатная квартира.\nПлощадь квартиры 38,1 м², этаж 9 из 17.\n\nОдин взрослый собственник.')
  })

  it('характеристики дома и условия', () => {
    const by = Object.fromEntries(l.params.map(p => [p.label, p.value]))
    expect(by['Тип дома']).toBe('Железобетон')
    expect(by['Парковка']).toBe('Во дворе')
    expect(by['Безопасность']).toBe('Домофон, Кодовая дверь')
    expect(by['Мусоропровод']).toBe('есть')
    expect(by['Тип продажи']).toBe('Свободная продажа')
    expect(by['Лифты']).toBe('пассажирских 1')
  })

  it('данные продавца и юридические сведения не попадают в результат', () => {
    expect(JSON.stringify(l)).not.toMatch(/собственник[ов]|owner_count|ownerCount|phone|\*\*\*/i)
  })

  it('соседние карточки «похожих» не подмешиваются', () => {
    expect(JSON.stringify(l)).not.toContain('2080032143')
  })
})

describe('domclick: разбор состояния страницы', () => {
  it('JS-литерал с undefined и \\u002F читается', () => {
    const state = extractState(fixture('flat-sale.html'))
    expect(state?.productCard?.id).toBe(1000000003)
    expect(state?.productCard?.href).toBe('https://domclick.ru/card/sale__flat__1000000003')
  })

  it('заглушка Qrator (JS-проверка) → blocked при любом статусе', () => {
    expect(extractOffer(fixture('qrator-stub.html'), 401).kind).toBe('blocked')
    expect(extractOffer(fixture('qrator-stub.html'), 200).kind).toBe('blocked')
    expect(extractOffer('<html></html>', 429).kind).toBe('blocked')
  })

  it('404 → not_found, пустая страница → unknown', () => {
    expect(extractOffer('', 404).kind).toBe('not_found')
    expect(extractOffer('<html><body>ok</body></html>').kind).toBe('unknown')
  })

  it('продано или ошибка загрузки карточки → not_found', () => {
    const make = (patch: object) => `<script>window.__SSR_STATE__={"productCard":${JSON.stringify({ id: 1, ...patch })}}</script>`
    expect(extractOffer(make({ priceInfo: { soldPrice: 100 } })).kind).toBe('not_found')
    expect(extractOffer(make({ _error: 'Not found' })).kind).toBe('not_found')
    expect(extractOffer(make({})).kind).toBe('ok')
  })

  it('адаптер: parseHtml повторяет разбор, matchUrl знает типы объектов', () => {
    expect(domclick.parseHtml!(fixture('flat-sale.html')).sourceId).toBe('1000000003')
    expect(() => domclick.parseHtml!(fixture('qrator-stub.html'))).toThrowError(expect.objectContaining({ code: 'captcha_required' }))
    expect(domclick.matchUrl(new URL('https://domclick.ru/card/sale__flat__1000000003'))?.sourceId).toBe('1000000003')
    expect(domclick.matchUrl(new URL('https://domclick.ru/card/rent__house__1000000003'))?.sourceId).toBe('1000000003')
    expect(domclick.matchUrl(new URL('https://domclick.ru/pokupka/kvartiry'))).toBeNull()
  })
})

describe('js-object: терпимый разбор JS-литералов', () => {
  it('undefined, NaN и Infinity вне строк → null', () => {
    expect(parseJsObject('{"a":undefined,"b":[NaN,Infinity,-Infinity],"c":1}')).toEqual({ a: null, b: [null, null, null], c: 1 })
  })

  it('слова внутри строк и идентификаторов не трогаются', () => {
    const src = '{"t":"значение undefined и NaN","isundefined":1,"x":undefinedValue}'
    expect(jsObjectToJson(src)).toBe('{"t":"значение undefined и NaN","isundefined":1,"x":undefinedValue}')
    expect(parseJsObject('{"t":"значение undefined и NaN","u":undefined}')).toEqual({ t: 'значение undefined и NaN', u: null })
  })

  it('кавычки с экранированием не сбивают строковый режим', () => {
    expect(parseJsObject('{"q":"say \\"undefined\\"","u":undefined}')).toEqual({ q: 'say "undefined"', u: null })
  })

  it('невалидное → null', () => {
    expect(parseJsObject('{oops')).toBeNull()
  })
})

// Типы объектов, аренда и участки: реальных страниц нет, проверяем логику сопоставления по структуре productCard
describe('domclick: сделка, тип, аренда, участок (логика без реальных страниц)', () => {
  it.each([
    [{ _deal: 'sale', _type: 'flat' }, 'sale', 'flat'],
    [{ _deal: 'rent', _type: 'flat' }, 'rent_long', 'flat'],
    [{ _deal: 'sale', _type: 'room' }, 'sale', 'room'],
    [{ _deal: 'sale', _type: 'house' }, 'sale', 'house'],
    [{ _deal: 'sale', _type: 'lot' }, 'sale', 'land'],
    [{ _deal: 'sale', _type: 'garage' }, 'sale', 'garage'],
    [{ _deal: 'rent', _type: 'commercial' }, 'rent_long', 'commercial'],
    [{ _deal: 'sale', _type: 'something' }, 'sale', 'other'],
  ])('%j → %s / %s', (c, deal, kind) => {
    expect(dealFromCard(c as DomclickCard)).toBe(deal)
    expect(kindFromCard(c as DomclickCard)).toBe(kind)
  })

  it('аренда: цена за месяц, залог и условия попадают в параметры', () => {
    const l = normalizeDomclick({
      id: 5, _deal: 'rent', _type: 'flat',
      objectInfo: { area: 40, rooms: 2, floor: 3 },
      priceInfo: { price: 55000, currency: 'RUB', deposit: 55000, commissionTypeField: 'Без комиссии', prepaymentMonths: 1 },
      rent: { withChildren: true, withAnimals: false, canSmoke: null, amenities: ['Холодильник', 'Wi-Fi'] },
    })
    expect(l.deal).toBe('rent_long')
    expect(l.price).toEqual({ value: 55000, currency: 'RUB', period: 'month' })
    const by = Object.fromEntries(l.params.map(p => [p.label, p.value]))
    expect(by['Залог']).toBe('55000 ₽')
    expect(by['Предоплата, мес.']).toBe('1')
    expect(by['Можно с детьми']).toBe('да')
    expect(by['Можно с животными']).toBe('нет')
    expect(by['Можно курить']).toBeUndefined()
    expect(by['Удобства']).toBe('Холодильник, Wi-Fi')
  })

  it('студия: rooms = 0 и параметр для маппера платформы', () => {
    const l = normalizeDomclick({ id: 6, _deal: 'sale', _type: 'flat', objectInfo: { area: 24, rooms: 0, floor: 2 }, priceInfo: { price: 5 } })
    expect(l.rooms).toBe(0)
    expect(l.params[0]).toMatchObject({ label: 'Количество комнат', value: 'студия' })
    expect(l.title).toBe('Студия, 24 м², 2 эт.')
  })

  it.each([
    [{ area: 6, areaUnit: 'sotka' }, 6],
    [{ area: 6, areaUnit: 'сот.' }, 6],
    [{ area: 1.5, areaUnit: 'ha' }, 150],
    [{ area: 2, areaUnit: 'га' }, 200],
    [{ area: 600, areaUnit: 'м²' }, 6],
    [{ area: 8, areaUnit: null }, 8],
    [{ area: null, areaUnit: null }, undefined],
  ])('участок %j → %s сот.', (land, sotka) => {
    expect(landToSotka(land)).toBe(sotka)
  })

  it('дом с участком: площади и заголовок', () => {
    const l = normalizeDomclick({ id: 7, _deal: 'sale', _type: 'house', objectInfo: { area: 120 }, land: { area: 8, areaUnit: 'sotka' }, priceInfo: { price: 9 } })
    expect(l.area).toEqual({ total: 120, landSotka: 8 })
    expect(l.title).toBe('Дом, 120 м², участок 8 сот.')
  })

  it('цена в другой валюте → предупреждение', () => {
    const l = normalizeDomclick({ id: 8, _deal: 'sale', _type: 'flat', priceInfo: { price: 1000, currency: 'USD' } })
    expect(l.warnings).toContain('price_currency_unknown')
  })
})
