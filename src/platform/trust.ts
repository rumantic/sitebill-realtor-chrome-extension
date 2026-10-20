/**
 * Какие сайты считаются «платформой» (чистая логика, без обращений к browser.*).
 *
 * Известные зоны подключены статически (content_scripts в манифесте).
 * Домены тенантов произвольные — они подключаются пользователем в popup и хранятся отдельно.
 */

/** match-patterns статически подключённых доменов (порт в паттернах Chrome не указывается). */
export const STATIC_PLATFORM_MATCHES = [
  'https://*.etownpro.ru/*',
  'https://*.sitebill.site/*',
  'http://localhost/*',
  'https://localhost/*',
]

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/** Нормализует произвольную строку до origin платформы или null, если подключать такой сайт нельзя. */
export function normalizePlatformOrigin(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return null
  }
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return url.origin
  return null
}

/** match-pattern для origin: схема + хост, порт игнорируется Chrome. */
export function originToPattern(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.hostname}/*`
}

function staticPatternMatches(origin: string, pattern: string): boolean {
  const url = new URL(origin)
  const m = pattern.match(/^(https?):\/\/([^/]+)\/\*$/)
  if (!m) return false
  const [, scheme, host] = m
  if (`${scheme}:` !== url.protocol) return false
  if (host!.startsWith('*.')) {
    const domain = host!.slice(2)
    return url.hostname === domain || url.hostname.endsWith('.' + domain)
  }
  return url.hostname === host
}

export function isStaticallyTrusted(origin: string): boolean {
  return STATIC_PLATFORM_MATCHES.some(p => staticPatternMatches(origin, p))
}

/** Доверенный origin: известная зона либо подключённый пользователем (сравнение по origin целиком). */
export function isTrustedOrigin(origin: string, connected: string[]): boolean {
  return isStaticallyTrusted(origin) || connected.includes(origin)
}
