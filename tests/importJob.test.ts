import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportedListing } from '../src/shared/protocol'
import type { TabApi } from '../src/platform/captchaTab'
import type { ImportDeps } from '../src/platform/importJob'
import type { SourceAdapter } from '../src/sources/types'

const LISTING = { sourceId: '42' } as unknown as ImportedListing

type Out = { type: string, [k: string]: any }

// Лимитер заданий общий на модуль (6 в минуту) — на каждый тест берём свежий модуль
let runImport: typeof import('../src/platform/importJob').runImport
// Класс ошибки берём из того же свежего графа модулей, что и runImport, — иначе instanceof не сработает
let SourceError: typeof import('../src/sources/types').SourceError
beforeEach(async () => {
  vi.resetModules()
  runImport = (await import('../src/platform/importJob')).runImport
  SourceError = (await import('../src/sources/types')).SourceError
})

function makeAdapter(over: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id: 'avito', label: 'Тест', hosts: ['example.com'], version: 1,
    matchUrl: () => ({ sourceId: '42' }),
    load: async () => { throw new SourceError('captcha_required', 'проверка') },
    parseHtml: (html: string) => {
      if (html === 'OK') return LISTING
      throw new SourceError('captcha_required')
    },
    ...over,
  }
}

function makeTabs(htmlAt: (t: number) => string | null = () => 'OK') {
  let t = 0
  const log = { focus: [] as number[], close: [] as number[], open: [] as string[] }
  const api: TabApi = {
    async open(url) { log.open.push(url); return 5 },
    async focus(id) { log.focus.push(id) },
    async status() { return 'complete' },
    async readHtml() { return htmlAt(t) },
    async close(id) { log.close.push(id) },
  }
  return { api, log, tabOptions: { now: () => t, sleep: async (ms: number) => { t += ms } } }
}

function start(adapter: SourceAdapter, deps: ImportDeps, tabId = 1) {
  const out: Out[] = []
  const cancel = runImport(tabId, 'r1', 'https://example.com/x', m => out.push(m as Out), {
    resolveAdapter: () => ({ adapter, url: new URL('https://example.com/x'), match: { sourceId: '42' } }),
    ...deps,
  })
  const finished = () => out.some(m => m.type === 'result' || m.type === 'error')
  return { out, cancel, done: () => vi.waitFor(() => expect(finished()).toBe(true)) }
}

describe('runImport: запасной путь через вкладку', () => {
  it('fetch упёрся в проверку → страница берётся из вкладки, пользователь получает результат', async () => {
    const tabs = makeTabs()
    const job = start(makeAdapter(), { tabs: tabs.api, tabOptions: tabs.tabOptions })
    await job.done()

    expect(job.out.map(m => m.type)).toEqual(['progress', 'progress', 'result'])
    expect(job.out.at(-1)!.listing).toBe(LISTING)
    expect(tabs.log.open).toEqual(['https://example.com/x'])
    expect(tabs.log.close).toEqual([5])
  })

  it('пользователю нужно пройти проверку → платформа получает waiting_captcha, потом результат', async () => {
    const tabs = makeTabs(t => (t < 20_000 ? 'CAPTCHA' : 'OK'))
    const job = start(makeAdapter(), { tabs: tabs.api, tabOptions: tabs.tabOptions })
    await job.done()

    const stages = job.out.filter(m => m.type === 'progress').map(m => m.stage)
    expect(stages).toEqual(['matching', 'loading', 'waiting_captcha'])
    expect(job.out.at(-1)!.type).toBe('result')
    expect(tabs.log.focus).toEqual([5, 1]) // вкладка площадки вперёд, затем обратно на страницу платформы (tabId=1)
  })

  it('вкладок нет (или адаптер не умеет parseHtml) → прежняя ошибка captcha_required с пояснением', async () => {
    const noTabs = start(makeAdapter(), {})
    await noTabs.done()
    expect(noTabs.out.at(-1)).toMatchObject({ type: 'error', code: 'captcha_required', message: 'проверка' })

    const tabs = makeTabs()
    const noParse = start(makeAdapter({ parseHtml: undefined }), { tabs: tabs.api }, 2)
    await noParse.done()
    expect(noParse.out.at(-1)).toMatchObject({ type: 'error', code: 'captcha_required' })
    expect(tabs.log.open).toEqual([])
  })

  it('другие ошибки fetch (объявление не найдено) во вкладку не ведут', async () => {
    const tabs = makeTabs()
    const job = start(makeAdapter({ load: async () => { throw new SourceError('not_found') } }), { tabs: tabs.api })
    await job.done()

    expect(job.out.at(-1)).toMatchObject({ type: 'error', code: 'not_found' })
    expect(tabs.log.open).toEqual([])
  })

  it('проверка не пройдена вовремя → captcha_required, вкладка закрыта', async () => {
    const tabs = makeTabs(() => 'CAPTCHA')
    const job = start(makeAdapter(), { tabs: tabs.api, tabOptions: { ...tabs.tabOptions, timeoutMs: 30_000 } })
    await job.done()

    expect(job.out.at(-1)).toMatchObject({ type: 'error', code: 'captcha_required' })
    expect(tabs.log.close).toEqual([5])
  })

  it('отмена из платформы во время ожидания: вкладка закрыта, ответ один — cancelled', async () => {
    const tabs = makeTabs(() => 'CAPTCHA')
    // sleep не продвигает время, пока не отменят: цикл ожидания крутится, как при живой проверке
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const job = start(makeAdapter(), { tabs: tabs.api, tabOptions: { sleep: () => gate } })

    await vi.waitFor(() => expect(tabs.log.open).toHaveLength(1))
    job.cancel()
    release()
    await vi.waitFor(() => expect(tabs.log.close).toEqual([5]))

    expect(job.out.filter(m => m.type === 'error')).toEqual([expect.objectContaining({ code: 'cancelled' })])
    expect(job.out.some(m => m.type === 'result')).toBe(false)
  })

  it('отмена уже завершённого задания ничего не шлёт', async () => {
    const tabs = makeTabs()
    const job = start(makeAdapter(), { tabs: tabs.api, tabOptions: tabs.tabOptions })
    await job.done()
    const before = job.out.length

    job.cancel()
    expect(job.out).toHaveLength(before)
  })
})
