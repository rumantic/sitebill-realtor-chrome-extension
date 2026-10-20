import type { ImportErrorCode } from '../shared/protocol'
import { SourceError } from './types'

/**
 * Загрузка страницы площадки из service worker: с куками пользователя (его IP, его сессия, его капча),
 * без eval и DOM. Сетевая ошибка → `blocked`.
 */
export async function fetchHtml(url: URL): Promise<{ html: string, status: number }> {
  try {
    const res = await fetch(url.toString(), { credentials: 'include', redirect: 'follow' })
    return { html: await res.text(), status: res.status }
  }
  catch {
    throw new SourceError('blocked', 'Не удалось загрузить страницу площадки')
  }
}

const ERROR_BY_KIND: Record<'blocked' | 'not_found' | 'unknown', ImportErrorCode> = {
  blocked: 'captcha_required',
  not_found: 'not_found',
  unknown: 'parse_failed',
}

/** Результат неудачного extract → ошибка протокола с понятным сообщением. */
export function sourceErrorFor(kind: 'blocked' | 'not_found' | 'unknown'): SourceError {
  return new SourceError(
    ERROR_BY_KIND[kind],
    kind === 'blocked'
      ? 'Площадка просит подтвердить, что вы не робот. Откройте объявление в браузере, пройдите проверку и повторите импорт.'
      : undefined,
  )
}
