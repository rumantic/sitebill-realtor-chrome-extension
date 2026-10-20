import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ImportedListing } from '../src/shared/protocol'
import { loadViaTab, type TabApi } from '../src/platform/captchaTab'
import { avito } from '../src/sources/avito'
import { SourceError } from '../src/sources/types'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/avito/${name}`, import.meta.url), 'utf8')
const URL_ = new URL('https://www.avito.ru/sochi/doma_dachi_kottedzhi/dom_1462_m_na_uchastke_44_sot._1000000001')
const LISTING = { sourceId: '1' } as unknown as ImportedListing

/** Виртуальные часы + сценарий вкладки: что видит loadViaTab в каждый момент времени. */
function setup(script: (t: number) => { status: 'loading' | 'complete' | 'gone', html?: string | null }) {
  let t = 0
  const calls = { open: 0, focus: [] as number[], close: [] as number[], read: 0 }
  const api: TabApi = {
    async open() { calls.open++; return 7 },
    async focus(id) { calls.focus.push(id) },
    async status() { return script(t).status },
    async readHtml() { calls.read++; return script(t).html ?? null },
    async close(id) { calls.close.push(id) },
  }
  const opts = {
    now: () => t,
    sleep: async (ms: number) => { t += ms },
  }
  return { api, calls, opts, time: () => t }
}

/** parse как у адаптера: 'OK' → данные, 'CAPTCHA' → проверка, 'GONE' → снято, 'JUNK' → данных нет */
function parse(html: string): ImportedListing {
  if (html === 'OK') return LISTING
  if (html === 'CAPTCHA') throw new SourceError('captcha_required')
  if (html === 'GONE') throw new SourceError('not_found')
  throw new SourceError('parse_failed')
}

describe('loadViaTab', () => {
  it('проверки нет: данные берутся из неактивной вкладки, пользователь ничего не видит', async () => {
    const s = setup(() => ({ status: 'complete', html: 'OK' }))
    const onWaitingUser = vi.fn()

    await expect(loadViaTab(s.api, URL_, { ...s.opts, parse, onWaitingUser, returnFocusTo: 99 })).resolves.toBe(LISTING)

    expect(s.calls.focus).toEqual([]) // фокус не забирали и не возвращали
    expect(onWaitingUser).not.toHaveBeenCalled()
    expect(s.calls.close).toEqual([7])
  })

  it('браузер прошёл проверку сам за время тихого ожидания — вкладка так и не показана', async () => {
    const s = setup(t => ({ status: 'complete', html: t < 3000 ? 'CAPTCHA' : 'OK' }))
    const onWaitingUser = vi.fn()

    await loadViaTab(s.api, URL_, { ...s.opts, parse, onWaitingUser })
    expect(s.calls.focus).toEqual([])
    expect(onWaitingUser).not.toHaveBeenCalled()
  })

  it('проверка на экране: вкладка выводится вперёд, потом закрывается, фокус возвращается на платформу', async () => {
    const s = setup(t => ({ status: 'complete', html: t < 20_000 ? 'CAPTCHA' : 'OK' }))
    const onWaitingUser = vi.fn()

    await expect(loadViaTab(s.api, URL_, { ...s.opts, parse, onWaitingUser, returnFocusTo: 99 })).resolves.toBe(LISTING)

    expect(onWaitingUser).toHaveBeenCalledTimes(1)
    expect(s.calls.focus).toEqual([7, 99]) // сначала вкладка площадки, в конце — страница платформы
    expect(s.calls.close).toEqual([7])
    expect(s.time()).toBeGreaterThanOrEqual(20_000)
  })

  it('проверку не прошли за отведённое время → captcha_required, вкладка закрыта', async () => {
    const s = setup(() => ({ status: 'complete', html: 'CAPTCHA' }))
    const err = await loadViaTab(s.api, URL_, { ...s.opts, parse, timeoutMs: 30_000, returnFocusTo: 99 }).catch(e => e)

    expect(err).toBeInstanceOf(SourceError)
    expect(err.code).toBe('captcha_required')
    expect(err.message).toMatch(/не пройдена/)
    expect(s.calls.close).toEqual([7])
    expect(s.calls.focus).toEqual([7, 99])
  })

  it('пользователь закрыл вкладку → cancelled', async () => {
    const s = setup(t => (t < 10_000 ? { status: 'complete', html: 'CAPTCHA' } : { status: 'gone' }))
    const err = await loadViaTab(s.api, URL_, { ...s.opts, parse }).catch(e => e)
    expect(err.code).toBe('cancelled')
  })

  it('отмена импорта (signal) → cancelled, вкладка закрыта', async () => {
    const ac = new AbortController()
    const s = setup(() => ({ status: 'complete', html: 'CAPTCHA' }))
    const opts = { ...s.opts, sleep: async (ms: number) => { await s.opts.sleep(ms); if (s.time() > 3000) ac.abort() } }

    const err = await loadViaTab(s.api, URL_, { ...opts, parse, signal: ac.signal }).catch(e => e)
    expect(err.code).toBe('cancelled')
    expect(s.calls.close).toEqual([7])
  })

  it('страница загружена, а данных нет и это не проверка → parse_failed после льготного срока', async () => {
    const s = setup(() => ({ status: 'complete', html: 'JUNK' }))
    const err = await loadViaTab(s.api, URL_, { ...s.opts, parse, unknownGraceMs: 10_000 }).catch(e => e)
    expect(err.code).toBe('parse_failed')
    expect(s.time()).toBeLessThan(30_000) // не ждём весь таймаут
  })

  it('объявление снято → not_found сразу, без ожидания', async () => {
    const s = setup(() => ({ status: 'complete', html: 'GONE' }))
    const err = await loadViaTab(s.api, URL_, { ...s.opts, parse }).catch(e => e)
    expect(err.code).toBe('not_found')
    expect(s.time()).toBe(0)
  })

  it('пока вкладка грузится, HTML не читается', async () => {
    const s = setup(t => (t < 3000 ? { status: 'loading' } : { status: 'complete', html: 'OK' }))
    await loadViaTab(s.api, URL_, { ...s.opts, parse })
    expect(s.calls.read).toBe(1)
  })

  it('непредвиденная ошибка разбора пробрасывается как есть', async () => {
    const s = setup(() => ({ status: 'complete', html: 'OK' }))
    const err = await loadViaTab(s.api, URL_, { ...s.opts, parse: () => { throw new TypeError('bug') } }).catch(e => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(s.calls.close).toEqual([7])
  })
})

describe('loadViaTab с настоящими страницами', () => {
  it('заглушка Авито → ожидание; страница объявления → данные', async () => {
    const s = setup(t => ({ status: 'complete', html: t < 8000 ? fixture('blocked.html') : fixture('house-sale.html') }))
    const onWaitingUser = vi.fn()

    const listing = await loadViaTab(s.api, URL_, { ...s.opts, parse: html => avito.parseHtml!(html), onWaitingUser })

    expect(listing.sourceId).toBe('1000000001')
    expect(onWaitingUser).toHaveBeenCalledTimes(1)
  })
})
