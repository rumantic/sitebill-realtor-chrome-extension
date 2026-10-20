import type { ImportedListing, ImportErrorCode, SourceId } from '../shared/protocol'

export interface UrlMatch {
  sourceId: string
}

/** Ошибка адаптера с кодом протокола — доезжает до страницы платформы как есть. */
export class SourceError extends Error {
  constructor(public code: ImportErrorCode, message?: string) {
    super(message ?? code)
  }
}

export interface SourceAdapter {
  id: SourceId
  label: string
  /** Домены (с поддоменами). Попадают в host_permissions и allowlist. */
  hosts: string[]
  /** Версия правил разбора — для диагностики «сломался парсер». */
  version: number
  /** Это ссылка на конкретное объявление (а не на выдачу)? */
  matchUrl(url: URL): UrlMatch | null
  /**
   * Разбор уже полученного HTML страницы (из fetch или из вкладки браузера). Бросает SourceError:
   * captcha_required — вместо данных проверка, not_found — объявление снято, parse_failed — данных нет/формат изменился.
   */
  parseHtml?(html: string, status?: number): ImportedListing
  /** Загрузка и разбор. Отсутствует, пока адаптер не реализован. Ошибки — через SourceError. */
  load?(url: URL, match: UrlMatch): Promise<ImportedListing>
}
