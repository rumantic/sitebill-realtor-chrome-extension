/** Скользящее окно: не больше `limit` заданий за `windowMs`. Защищает площадки и пользователя от шквала запросов. */
export class RateLimiter {
  private stamps: number[] = []

  constructor(private limit = 6, private windowMs = 60_000) {}

  tryAcquire(now = Date.now()): boolean {
    this.stamps = this.stamps.filter(t => now - t < this.windowMs)
    if (this.stamps.length >= this.limit) return false
    this.stamps.push(now)
    return true
  }
}
