import type { ImportedListing } from '../../shared/protocol'
import type { SourceAdapter } from '../types'
import { fetchHtml, sourceErrorFor } from '../http'
import { extractOffer } from './extract'
import { YOULA_ADAPTER_VERSION, normalizeYoula } from './normalize'

function parseHtml(html: string, status = 200): ImportedListing {
  const extracted = extractOffer(html, status)
  if (extracted.kind !== 'ok') throw sourceErrorFor(extracted.kind)
  return normalizeYoula(extracted.offer)
}

export const youla: SourceAdapter = {
  id: 'youla',
  label: 'Юла',
  hosts: ['youla.ru'],
  version: YOULA_ADAPTER_VERSION,
  // /all/nedvijimost/prodaja-doma/dom-187-m2-0123456789abcdef01234567 — id (24 hex) в конце адреса
  matchUrl(url) {
    const m = url.pathname.match(/-([0-9a-f]{24})\/?$/)
    return m?.[1] ? { sourceId: m[1] } : null
  },

  parseHtml,

  async load(url) {
    const target = new URL(url)
    target.hash = ''
    target.search = ''

    const { html, status } = await fetchHtml(target)
    return parseHtml(html, status)
  },
}
