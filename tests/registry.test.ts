import { describe, expect, it } from 'vitest'
import { resolveAdapter } from '../src/sources/registry'

describe('resolveAdapter', () => {
  const cases: [string, string, string][] = [
    ['https://www.avito.ru/sochi/doma_dachi_kottedzhi/dom_90_m_na_uchastke_10_sot._1000000002', 'avito', '1000000002'],
    ['https://m.avito.ru/sochi/doma_dachi_kottedzhi/dom_90_m_1000000002?context=abc', 'avito', '1000000002'],
    ['https://www.cian.ru/sale/flat/123456789/', 'cian', '123456789'],
    ['https://spb.cian.ru/rent/suburban/987654321/', 'cian', '987654321'],
    ['https://domclick.ru/card/sale__flat__2062359283', 'domclick', '2062359283'],
    ['https://realty.yandex.ru/offer/1234567890123456789/', 'yandex-realty', '1234567890123456789'],
    ['https://youla.ru/all/nedvijimost/prodaja-doma/dom-187-m2-0123456789abcdef01234567', 'youla', '0123456789abcdef01234567'],
    ['https://youla.ru/krasnodar/nedvijimost/prodaja-kvartir/kvartira-0123456789abcdef01234567/', 'youla', '0123456789abcdef01234567'],
  ]

  it.each(cases)('%s → %s', (url, adapter, sourceId) => {
    const r = resolveAdapter(url)
    expect(r?.adapter.id).toBe(adapter)
    expect(r?.match.sourceId).toBe(sourceId)
  })

  it.each([
    'http://www.avito.ru/sochi/x_1000000002', // не https
    'https://www.avito.ru/sochi/doma_dachi_kottedzhi', // выдача, не объявление
    'https://www.cian.ru/cat.php?deal_type=sale', // выдача
    'https://evil.example/avito.ru/x_1000000002', // чужой хост
    'https://avito.ru.evil.example/x_1000000002', // похожий хост
    'https://notavito.ru/x_1000000002', // суффикс без точки
    'https://youla.ru/all/nedvijimost/prodaja-doma', // раздел, не объявление
    'https://notyoula.ru/x-0123456789abcdef01234567', // суффикс без точки
    'javascript:alert(1)',
    'not a url',
  ])('отклоняет %s', (url) => {
    expect(resolveAdapter(url)).toBeNull()
  })
})
