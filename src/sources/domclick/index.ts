import type { ImportedListing } from '../../shared/protocol'
import type { SourceAdapter } from '../types'
import { fetchHtml, sourceErrorFor } from '../http'
import { extractOffer } from './extract'
import { DOMCLICK_ADAPTER_VERSION, normalizeDomclick } from './normalize'

function parseHtml(html: string, status = 200): ImportedListing {
  const extracted = extractOffer(html, status)
  if (extracted.kind !== 'ok') throw sourceErrorFor(extracted.kind)
  return normalizeDomclick(extracted.card)
}

export const domclick: SourceAdapter = {
  id: 'domclick',
  label: 'Домклик',
  hosts: ['domclick.ru'],
  version: DOMCLICK_ADAPTER_VERSION,
  // /card/sale__flat__2062359283
  matchUrl(url) {
    const m = url.pathname.match(/^\/card\/(?:sale|rent)__[a-z_]+?__(\d+)\/?$/)
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
