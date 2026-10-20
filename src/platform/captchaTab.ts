/**
 * Загрузка страницы площадки через вкладку браузера — запасной путь, когда обычный fetch упёрся в проверку («капчу»).
 *
 * Как это выглядит для пользователя:
 *  1. Страница открывается в **неактивной** вкладке — настоящий браузер со своими cookie и отпечатком часто проходит
 *     проверку сам, и пользователь ничего не замечает.
 *  2. Если за `quietMs` данных нет — вкладка выводится на передний план, платформа получает подсказку
 *     «пройдите проверку» (`onWaitingUser`).
 *  3. Как только страница загрузилась с данными объявления — вкладка закрывается, фокус возвращается на платформу.
 *
 * Модуль не обращается к browser.* напрямую — вкладки приходят через TabApi (см. browserTabs.ts), поэтому логика
 * проверяется тестами без браузера. Скрытых обходов нет: вкладка видна в панели вкладок всё время.
 */
import type { ImportedListing } from '../shared/protocol'
import { SourceError } from '../sources/types'

export interface TabApi {
  /** Открыть адрес в неактивной вкладке, вернуть её id */
  open(url: string): Promise<number>
  /** Вывести вкладку на передний план (и её окно — на передний план ОС) */
  focus(tabId: number): Promise<void>
  /** 'gone' — вкладку закрыли (пользователь или браузер) */
  status(tabId: number): Promise<'loading' | 'complete' | 'gone'>
  /** Текущий HTML документа вкладки; null — прочитать нельзя (служебная страница, ошибка загрузки) */
  readHtml(tabId: number): Promise<string | null>
  close(tabId: number): Promise<void>
}

export interface TabLoadOptions {
  /** Разбор HTML; бросает SourceError: captcha_required — на экране проверка, parse_failed — данных пока нет */
  parse: (html: string) => ImportedListing
  signal?: AbortSignal
  /** Вкладка выведена на передний план — пользователю нужно пройти проверку */
  onWaitingUser?: () => void
  /** Вкладка, на которую вернуть фокус после проверки (страница платформы) */
  returnFocusTo?: number
  /** Сколько ждать тихо, прежде чем показать вкладку */
  quietMs?: number
  /** Общий предел ожидания, включая время на проверку */
  timeoutMs?: number
  /** Сколько терпеть «страница загружена, а данных нет», прежде чем признать, что формат изменился */
  unknownGraceMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULTS = {
  quietMs: 6_000,
  timeoutMs: 180_000,
  unknownGraceMs: 20_000,
  pollQuietMs: 1_000,
  pollWaitingMs: 2_000,
}

export async function loadViaTab(api: TabApi, url: URL, opts: TabLoadOptions): Promise<ImportedListing> {
  const quietMs = opts.quietMs ?? DEFAULTS.quietMs
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const unknownGraceMs = opts.unknownGraceMs ?? DEFAULTS.unknownGraceMs
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))

  const tabId = await api.open(url.toString())
  const startedAt = now()
  let escalated = false
  let unknownSince: number | null = null

  try {
    for (;;) {
      if (opts.signal?.aborted) throw new SourceError('cancelled')
      if (now() - startedAt > timeoutMs) {
        throw new SourceError('captcha_required', 'Проверка не пройдена вовремя. Повторите импорт и пройдите её в открывшейся вкладке.')
      }

      const status = await api.status(tabId)
      // Вкладку закрыли до результата — пользователь передумал
      if (status === 'gone') throw new SourceError('cancelled', 'Вкладка площадки закрыта до завершения проверки.')

      if (status === 'complete') {
        const html = await api.readHtml(tabId)
        if (html) {
          try {
            return opts.parse(html)
          }
          catch (e) {
            if (!(e instanceof SourceError)) throw e
            if (e.code === 'captcha_required') {
              // Проверка на экране — ждём пользователя (или автоматического прохождения)
              unknownSince = null
            }
            else if (e.code === 'parse_failed') {
              // Страница ещё догружается/редиректит; но если стоит загруженной и данных нет — формат изменился
              unknownSince ??= now()
              if (now() - unknownSince > unknownGraceMs) throw e
            }
            else {
              throw e // not_found и прочее — ждать нечего
            }
          }
        }
      }

      if (!escalated && now() - startedAt >= quietMs) {
        escalated = true
        await api.focus(tabId)
        opts.onWaitingUser?.()
      }
      await sleep(escalated ? DEFAULTS.pollWaitingMs : DEFAULTS.pollQuietMs)
    }
  }
  finally {
    await api.close(tabId).catch(() => {})
    // Фокус возвращаем, только если сами его забирали
    if (escalated && opts.returnFocusTo !== undefined) await api.focus(opts.returnFocusTo).catch(() => {})
  }
}
