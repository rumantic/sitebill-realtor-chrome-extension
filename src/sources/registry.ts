import type { SourceAdapter, UrlMatch } from './types'
import { avito } from './avito'
import { cian } from './cian'
import { domclick } from './domclick'
import { yandexRealty } from './yandex-realty'
import { youla } from './youla'

export const ADAPTERS: SourceAdapter[] = [avito, cian, domclick, yandexRealty, youla]

export const ALL_SOURCE_HOSTS: string[] = ADAPTERS.flatMap(a => a.hosts)

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain)
}

export function parseHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

/**
 * Allowlist источников: только https и только хосты зарегистрированных адаптеров.
 * Любой другой URL расширение не трогает (мост нельзя использовать как прокси с куками пользователя).
 */
export function resolveAdapter(rawUrl: string): { adapter: SourceAdapter, url: URL, match: UrlMatch } | null {
  const url = parseHttpsUrl(rawUrl)
  if (!url) return null
  for (const adapter of ADAPTERS) {
    if (!adapter.hosts.some(d => hostMatches(url.hostname, d))) continue
    const match = adapter.matchUrl(url)
    if (match) return { adapter, url, match }
  }
  return null
}
