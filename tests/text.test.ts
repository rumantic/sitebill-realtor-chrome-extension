import { describe, expect, it } from 'vitest'
import { fixHomoglyphs, htmlToText, parseNumber } from '../src/shared/text'

describe('fixHomoglyphs', () => {
  it('исправляет слова со смесью кириллицы и латиницы', () => {
    const { text, fixed } = fixHomoglyphs('Прeдлaгaетcя уютный двуxэтaжный дoм плoщaдью 90 м²')
    expect(text).toBe('Предлагается уютный двухэтажный дом площадью 90 м²')
    expect(fixed).toBe(4)
  })

  it('не трогает полностью латинские слова', () => {
    expect(fixHomoglyphs('Wi-Fi, BMW, Smart TV').text).toBe('Wi-Fi, BMW, Smart TV')
  })

  it('исправляет одиночную латинскую букву рядом с русским', () => {
    expect(fixHomoglyphs('c. Орёл-Изумруд, дом c видом').text).toBe('с. Орёл-Изумруд, дом с видом')
  })

  it('чистый русский текст не меняется', () => {
    const src = 'Дом в Сочи. Звоните!'
    expect(fixHomoglyphs(src)).toEqual({ text: src, fixed: 0 })
  })
})

describe('htmlToText', () => {
  it('абзацы и переносы → строки, теги и сущности убраны', () => {
    expect(htmlToText('<p>Первый&nbsp;абзац<br />ещё строка</p><p>Второй &amp; последний</p>'))
      .toBe('Первый абзац\nещё строка\nВторой & последний')
  })
})

describe('parseNumber', () => {
  it.each([
    ['146.2 м²', 146.2],
    ['1 250,5', 1250.5],
    ['10 сот.', 10],
    ['2', 2],
  ])('%s → %s', (src, n) => expect(parseNumber(src)).toBe(n))

  it('не число → undefined', () => {
    expect(parseNumber('студия')).toBeUndefined()
    expect(parseNumber(undefined)).toBeUndefined()
  })
})

import { parseAreaValue } from '../src/shared/text'

describe('parseAreaValue', () => {
  it.each([
    ['146.2 м²', { sqm: 146.2 }],
    ['10 сот.', { sotka: 10 }],
    ['1,5 га', { sotka: 150 }],
    ['2 га', { sotka: 200 }],
    ['студия', {}],
  ])('%s', (src, expected) => expect(parseAreaValue(src)).toEqual(expected))

  it('«га» внутри слова не считается гектарами', () => {
    expect(parseAreaValue('5 гараж')).toEqual({ sqm: 5 })
  })
})

import { removePhones, sanitizeDescription } from '../src/shared/text'

describe('removePhones', () => {
  it.each([
    ['Собственник 8/900/111/22/33', 'Собственник'],
    ['Звоните: +7 (900) 111-22-33 в любое время', 'Звоните: в любое время'],
    ['тел. 89001112233.', 'тел.'],
    ['пишите 900 111 22 33, отвечу', 'пишите, отвечу'],
    ['8 800 555 35 35 бесплатно', 'бесплатно'],
  ])('%s', (src, expected) => {
    const r = removePhones(src)
    expect(r.text).toBe(expected)
    expect(r.removed).toBe(1)
  })

  it('цены, площади, годы и номера домов не принимаются за телефон', () => {
    const src = 'Цена 24 000 000 руб., площадь 187 м², участок 7,8 сот., дом 2001 года, кадастровый 50:12:0000000:1234, ул. Мира 905'
    expect(removePhones(src)).toEqual({ text: src, removed: 0 })
  })

  it('два номера в тексте', () => {
    expect(removePhones('Анна 8-905-111-22-33, Иван 8 906 444 55 66').removed).toBe(2)
  })

  it('sanitizeDescription: телефоны удалены, гомоглифы исправлены, счётчики посчитаны', () => {
    const r = sanitizeDescription('Прeдлaгaетcя дом. Звоните 8 900 111 22 33 ')
    expect(r.text).toBe('Предлагается дом. Звоните')
    expect(r.fixed).toBeGreaterThan(0)
    expect(r.phones).toBe(1)
  })
})
