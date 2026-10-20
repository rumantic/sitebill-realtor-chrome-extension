import { describe, expect, it } from 'vitest'
import { attr, findByClass, hasClass, readJsonLd, stripNoise, textOf } from '../src/shared/html'

describe('hasClass', () => {
  it('имя с хешем сборки и без него', () => {
    expect(hasClass('A__b--x1Y2z C', 'A__b')).toBe(true)
    expect(hasClass('A__b', 'A__b')).toBe(true)
  })
  it('не путает префиксы', () => {
    expect(hasClass('A__bc--x1Y2z', 'A__b')).toBe(false)
    expect(hasClass('XA__b--x1Y2z', 'A__b')).toBe(false)
  })
})

describe('findByClass', () => {
  it('учитывает вложенные теги того же имени', () => {
    const html = '<div class="Box--a"><div>inner</div><div class="Box--a">second</div>tail</div><div class="Other--q">x</div>'
    const found = findByClass(html, 'Box')
    expect(found).toHaveLength(2)
    expect(found[0]!.inner).toBe('<div>inner</div><div class="Box--a">second</div>tail')
    expect(found[1]!.inner).toBe('second')
  })

  it('самозакрывающиеся и void-теги не ломают поиск', () => {
    const html = '<p class="T--1">a<br>b<img src="x"/>c</p><span class="T--2">z</span>'
    expect(findByClass(html, 'T')).toHaveLength(2)
    expect(textOf(findByClass(html, 'T')[0]!.inner)).toBe('a\nbc')
  })
})

describe('textOf / attr / stripNoise', () => {
  it('переносы, сущности и неразрывные пробелы', () => {
    expect(textOf('<p>65,8&nbsp;м²<br />общая &amp; жилая</p><p>второй</p>')).toBe('65,8 м²\nобщая & жилая\nвторой')
  })

  it('читает атрибуты в обеих кавычках и декодирует сущности', () => {
    expect(attr(' class="a" data-x=\'1&amp;2\'', 'data-x')).toBe('1&2')
    expect(attr(' data-latitude="45.07"', 'data-latitude')).toBe('45.07')
    expect(attr(' xdata-latitude="1"', 'data-latitude')).toBeUndefined()
  })

  it('stripNoise убирает script, style, svg и комментарии', () => {
    const html = '<script>var a="<div class=\'T--1\'>x</div>"</script><style>.T--1{}</style><svg><g/></svg><!-- <p class="T--1"> --><i class="T--1">ok</i>'
    expect(findByClass(stripNoise(html), 'T').map(e => e.inner)).toEqual(['ok'])
  })
})

describe('readJsonLd', () => {
  it('разбирает блоки и пропускает битые', () => {
    const html = '<script type="application/ld+json">{"@type":"A"}</script><script type="application/ld+json">{oops</script><script type=\'application/ld+json\'>[{"@type":"B"}]</script>'
    expect(readJsonLd(html)).toEqual([{ '@type': 'A' }, [{ '@type': 'B' }]])
  })
})
