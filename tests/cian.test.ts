import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractDefaultState, extractOffer } from '../src/sources/cian/extract'
import { dealFromOffer, kindFromOffer, normalizeCian } from '../src/sources/cian/normalize'
import { sliceBalanced } from '../src/shared/json-scan'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/cian/${name}`, import.meta.url), 'utf8')

function parse(name: string) {
  const r = extractOffer(fixture(name))
  if (r.kind !== 'ok') throw new Error(`extract: ${r.kind}`)
  return normalizeCian(r.offerData, new Date('2026-10-20T10:00:00Z'))
}

describe('cian: продажа квартиры в новостройке (реальная страница, обезличена)', () => {
  const l = parse('flat-sale.html')

  it('основные поля', () => {
    expect(l.source).toBe('cian')
    expect(l.sourceId).toBe('100000001')
    expect(l.sourceUrl).toBe('https://sochi.cian.ru/sale/flat/100000001/')
    expect(l.deal).toBe('sale')
    expect(l.propertyKind).toBe('flat')
    expect(l.price).toEqual({ value: 45500000, currency: 'RUB' })
    expect(l.partial).toBe(false)
  })

  it('площади, комнаты и этажность — из типизированных полей', () => {
    expect(l.area).toEqual({ total: 81.6, kitchen: 25 })
    expect(l.rooms).toBe(2)
    expect(l.floor).toBe(17)
    expect(l.floorsTotal).toBe(30)
    expect(l.buildYear).toBe(2021)
  })

  it('заголовок собирается из параметров', () => {
    expect(l.title).toBe('2-комн. квартира, 81,6 м², 17/30 эт.')
  })

  it('адрес — полными названиями, с координатами', () => {
    expect(l.address?.raw).toBe('Краснодарский край, Сочи, район Хостинский, микрорайон Приморье, Курортный проспект, 108')
    expect(l.address?.lat).toBeCloseTo(43.5516, 3)
    expect(l.address?.lng).toBeCloseTo(39.7798, 3)
  })

  it('характеристики из features, без юридического блока', () => {
    const byLabel = Object.fromEntries(l.params.map(p => [p.label, p.value]))
    expect(byLabel['Ремонт']).toBe('Дизайнерский')
    expect(byLabel['Высота потолков']).toBe('3,6 м')
    expect(byLabel['Тип дома']).toBe('Монолитный')
    expect(byLabel['Тип жилья']).toBe('Вторичка')
    expect(byLabel['ЖК']).toBe('Сан Сити, Дом 108')
    expect(byLabel['Несовершеннолетние собственники']).toBeUndefined()
  })

  it('фото без планировок', () => {
    expect(l.photos.map(p => p.url)).toEqual([
      'https://images.cdn-cian.ru/images/FIXTURE-1.jpg',
      'https://images.cdn-cian.ru/images/FIXTURE-2.jpg',
      'https://images.cdn-cian.ru/images/FIXTURE-3.jpg',
    ])
  })

  it('контакты продавца не попадают в результат', () => {
    expect(JSON.stringify(l)).not.toMatch(/phone|телефон|9898/i)
  })
})

describe('cian: устойчивость разбора', () => {
  it('скобки и кавычки внутри строк не ломают вырезание массива', () => {
    expect(extractDefaultState(fixture('flat-sale.html'))?.offerData?.offer?.id).toBe(100000001)
  })

  it('sliceBalanced учитывает экранирование', () => {
    const text = 'x = {"a":"} \\" ]","b":[1,{"c":2}]}; tail'
    expect(sliceBalanced(text, 4)).toBe('{"a":"} \\" ]","b":[1,{"c":2}]}')
    expect(sliceBalanced('[1,2', 0)).toBeNull()
    expect(sliceBalanced('abc', 0)).toBeNull()
  })

  it('нет данных → blocked при капче, unknown иначе, 404 → not_found', () => {
    expect(extractOffer('<html><body>Подтвердите, что вы не робот</body></html>').kind).toBe('blocked')
    expect(extractOffer('<html></html>', 429).kind).toBe('blocked')
    expect(extractOffer('<html></html>').kind).toBe('unknown')
    expect(extractOffer('', 404).kind).toBe('not_found')
  })

  it('снятое с публикации и архивное объявление → not_found', () => {
    const make = (offer: object) => `<script>window._cianConfig['frontend-offer-card'] = (window._cianConfig['frontend-offer-card'] || []).concat(${JSON.stringify([{ key: 'defaultState', value: { offerData: { offer } } }])});</script>`
    expect(extractOffer(make({ id: 1, status: 'deactivated' })).kind).toBe('not_found')
    expect(extractOffer(make({ id: 1, status: 'published', flags: { isArchived: true } })).kind).toBe('not_found')
    expect(extractOffer(make({ id: 1, status: 'published' })).kind).toBe('ok')
  })
})

// Категории — по справочнику ЦИАН; страниц этих типов в фикстурах пока нет, проверяем только логику сопоставления
describe('cian: сделка и тип объекта по категории', () => {
  it.each([
    [{ category: 'flatSale', dealType: 'sale' }, 'sale', 'flat'],
    [{ category: 'newBuildingFlatSale', dealType: 'sale' }, 'sale', 'flat'],
    [{ category: 'flatRent', dealType: 'rent' }, 'rent_long', 'flat'],
    [{ category: 'dailyFlatRent', dealType: 'rent' }, 'rent_daily', 'flat'],
    [{ category: 'roomSale', dealType: 'sale' }, 'sale', 'room'],
    [{ category: 'houseSale', dealType: 'sale', offerType: 'suburban' }, 'sale', 'house'],
    [{ category: 'cottageRent', dealType: 'rent', offerType: 'suburban' }, 'rent_long', 'house'],
    [{ category: 'landSale', dealType: 'sale', offerType: 'suburban' }, 'sale', 'land'],
    [{ category: 'officeRent', dealType: 'rent', offerType: 'commercial' }, 'rent_long', 'commercial'],
    [{ category: 'garageSale', dealType: 'sale', offerType: 'commercial' }, 'sale', 'garage'],
  ])('%j → %s / %s', (offer, deal, kind) => {
    expect(dealFromOffer(offer)).toBe(deal)
    expect(kindFromOffer(offer)).toBe(kind)
  })

  it('участок в гектарах переводится в сотки, студия — rooms=0', () => {
    const data = {
      offer: { id: 5, category: 'houseSale', dealType: 'sale', offerType: 'suburban', totalArea: '120', land: { area: '1.5', areaUnitType: 'hectare' }, flatType: 'studio', priceTotalRur: 1000 },
    }
    const l = normalizeCian(data)
    expect(l.area).toEqual({ total: 120, landSotka: 150 })
    expect(l.rooms).toBe(0)
    expect(l.params[0]).toMatchObject({ label: 'Количество комнат', value: 'студия' })
    expect(l.title).toBe('Дом, 120 м², участок 150 сот.')
  })
})

describe('cian: настоящая страница-заглушка (капча)', () => {
  it('распознаётся как blocked, а не как ошибка разбора', () => {
    expect(extractOffer(fixture('blocked.html')).kind).toBe('blocked')
  })
})
