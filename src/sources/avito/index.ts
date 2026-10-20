import type { ImportedListing } from '../../shared/protocol'
import type { SourceAdapter } from '../types'
import { fetchHtml, sourceErrorFor } from '../http'
import { extractListing } from './extract'
import { AVITO_ADAPTER_VERSION, normalizeAvito } from './normalize'

function parseHtml(html: string, status = 200): ImportedListing {
  const extracted = extractListing(html, status)
  if (extracted.kind !== 'ok') throw sourceErrorFor(extracted.kind)
  return normalizeAvito(extracted.buyerItem)
}

export const avito: SourceAdapter = {
  id: 'avito',
  label: 'Авито',
  hosts: ['avito.ru'],
  version: AVITO_ADAPTER_VERSION,
  // /sochi/doma_dachi_kottedzhi/dom_90_m_na_uchastke_10_sot._1000000002
  matchUrl(url) {
    const m = url.pathname.match(/_(\d{6,})\/?$/)
    return m?.[1] ? { sourceId: m[1] } : null
  },

  parseHtml,

  async load(url) {
    // Мобильная версия отдаёт другую разметку — всегда берём десктопную.
    const target = new URL(url)
    if (target.hostname === 'm.avito.ru') target.hostname = 'www.avito.ru'
    target.hash = ''

    const { html, status } = await fetchHtml(target)
    return parseHtml(html, status)
  },
}
