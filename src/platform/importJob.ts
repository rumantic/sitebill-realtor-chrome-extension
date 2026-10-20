import type { ExtToPage, ImportErrorCode, ImportedListing } from '../shared/protocol'
import { BRIDGE_CHANNEL, PROTOCOL_VERSION } from '../shared/protocol'
import { resolveAdapter as defaultResolveAdapter } from '../sources/registry'
import { SourceError } from '../sources/types'
import { loadViaTab, type TabApi } from './captchaTab'
import { RateLimiter } from './rateLimit'

type Out = Exclude<ExtToPage, { type: 'hello_ok' }>
type OutBody = Out extends infer T ? (T extends unknown ? Omit<T, 'channel' | 'protocol' | 'dir'> : never) : never

const limiter = new RateLimiter()
/** Одно активное задание на вкладку. */
const activeByTab = new Map<number, string>()

function wrap(body: OutBody): Out {
  return { channel: BRIDGE_CHANNEL, protocol: PROTOCOL_VERSION, dir: 'to-page', ...body } as Out
}

/** Зависимости задания — подменяются в тестах; в расширении tabs приходит из background.ts. */
export interface ImportDeps {
  resolveAdapter?: typeof defaultResolveAdapter
  /** Вкладки браузера для запасного пути при проверке (капче). Без них проверка сразу даёт captcha_required. */
  tabs?: TabApi
  /** Параметры ожидания проверки — для тестов */
  tabOptions?: { quietMs?: number, timeoutMs?: number, unknownGraceMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }
}

/**
 * Выполняет импорт и сообщает о ходе через emit. Возвращает функцию отмены.
 * Все проверки (allowlist, лимиты) — здесь, а не на стороне страницы.
 *
 * Порядок: тихий fetch из service worker → если площадка потребовала проверку, страница открывается во вкладке
 * (сначала неактивной, при необходимости — на переднем плане) и разбирается оттуда.
 */
export function runImport(
  tabId: number,
  requestId: string,
  rawUrl: string,
  emit: (msg: Out) => void,
  deps: ImportDeps = {},
): () => void {
  let cancelled = false
  let finished = false
  const abort = new AbortController()
  const resolveAdapter = deps.resolveAdapter ?? defaultResolveAdapter
  const fail = (code: ImportErrorCode, message?: string) => emit(wrap({ type: 'error', requestId, code, message }))

  if (activeByTab.has(tabId)) {
    fail('busy')
    return () => {}
  }
  if (!limiter.tryAcquire()) {
    fail('rate_limited')
    return () => {}
  }

  activeByTab.set(tabId, requestId)
  const done = () => {
    if (activeByTab.get(tabId) === requestId) activeByTab.delete(tabId)
  }

  void (async () => {
    try {
      emit(wrap({ type: 'progress', requestId, stage: 'matching' }))
      const resolved = resolveAdapter(rawUrl)
      if (!resolved) return fail('unsupported_url')

      const { adapter, url, match } = resolved
      if (!adapter.load) return fail('not_implemented', `Адаптер «${adapter.label}» ещё не реализован`)

      emit(wrap({ type: 'progress', requestId, stage: 'loading' }))

      let listing: ImportedListing
      try {
        listing = await adapter.load(url, match)
      }
      catch (e) {
        // Площадка потребовала проверку — пробуем настоящую вкладку; без неё (или без parseHtml) отдаём ошибку как есть
        const needsTab = e instanceof SourceError && e.code === 'captcha_required' && deps.tabs && adapter.parseHtml
        if (!needsTab) throw e

        const parse = adapter.parseHtml!
        listing = await loadViaTab(deps.tabs!, url, {
          parse: html => parse(html),
          signal: abort.signal,
          returnFocusTo: tabId,
          onWaitingUser: () => emit(wrap({ type: 'progress', requestId, stage: 'waiting_captcha' })),
          ...deps.tabOptions,
        })
      }

      if (cancelled) return
      emit(wrap({ type: 'result', requestId, listing }))
    }
    catch (e) {
      if (cancelled) return
      if (e instanceof SourceError) fail(e.code, e.message === e.code ? undefined : e.message)
      else fail('parse_failed', e instanceof Error ? e.message : undefined)
    }
    finally {
      finished = true
      done()
    }
  })()

  return () => {
    if (finished) return
    cancelled = true
    abort.abort()
    done()
    fail('cancelled')
  }
}
