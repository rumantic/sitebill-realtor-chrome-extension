import type { ImportedListing } from '../../shared/protocol'
import type { SourceAdapter } from '../types'
import { fetchHtml, sourceErrorFor } from '../http'
import { extractOffer } from './extract'
import { CIAN_ADAPTER_VERSION, normalizeCian } from './normalize'

function parseHtml(html: string, status = 200): ImportedListing {
  const extracted = extractOffer(html, status)
  if (extracted.kind !== 'ok') throw sourceErrorFor(extracted.kind)
  return normalizeCian(extracted.offerData)
}

export const cian: SourceAdapter = {
  id: 'cian',
  label: 'ЦИАН',
  hosts: ['cian.ru'],
  version: CIAN_ADAPTER_VERSION,
  // /sale/flat/123456789/, /rent/suburban/123456789/
  matchUrl(url) {
    const m = url.pathname.match(/^\/(?:sale|rent)\/[a-z-]+\/(\d+)\/?$/)
    return m?.[1] ? { sourceId: m[1] } : null
  },

  parseHtml,

  async load(url) {
    const target = new URL(url)
    target.hash = ''

    const { html, status } = await fetchHtml(target)
    return parseHtml(html, status)
  },
}
