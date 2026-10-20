import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../src/platform/rateLimit'
import { isTrustedOrigin, normalizePlatformOrigin, originToPattern } from '../src/platform/trust'

describe('normalizePlatformOrigin', () => {
  it('принимает https и localhost', () => {
    expect(normalizePlatformOrigin('https://crm.agency.ru/admin/x?y=1')).toBe('https://crm.agency.ru')
    expect(normalizePlatformOrigin('http://localhost:3000/admin')).toBe('http://localhost:3000')
  })
  it('отклоняет http на боевом домене и мусор', () => {
    expect(normalizePlatformOrigin('http://crm.agency.ru')).toBeNull()
    expect(normalizePlatformOrigin('chrome://settings')).toBeNull()
    expect(normalizePlatformOrigin('nope')).toBeNull()
  })
})

describe('originToPattern', () => {
  it('отбрасывает порт', () => {
    expect(originToPattern('http://localhost:3000')).toBe('http://localhost/*')
    expect(originToPattern('https://crm.agency.ru')).toBe('https://crm.agency.ru/*')
  })
})

describe('isTrustedOrigin', () => {
  it('известные зоны доверенные', () => {
    expect(isTrustedOrigin('https://balka.etownpro.ru', [])).toBe(true)
    expect(isTrustedOrigin('http://localhost:3000', [])).toBe(true)
  })
  it('похожие домены — нет', () => {
    expect(isTrustedOrigin('https://etownpro.ru.evil.example', [])).toBe(false)
    expect(isTrustedOrigin('https://notetownpro.ru', [])).toBe(false)
  })
  it('подключённый origin сравнивается целиком', () => {
    expect(isTrustedOrigin('https://crm.agency.ru', ['https://crm.agency.ru'])).toBe(true)
    expect(isTrustedOrigin('https://other.agency.ru', ['https://crm.agency.ru'])).toBe(false)
  })
})

describe('RateLimiter', () => {
  it('ограничивает число заданий в окне', () => {
    const l = new RateLimiter(2, 1000)
    expect(l.tryAcquire(0)).toBe(true)
    expect(l.tryAcquire(10)).toBe(true)
    expect(l.tryAcquire(20)).toBe(false)
    expect(l.tryAcquire(1500)).toBe(true)
  })
})
