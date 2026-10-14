/**
 * In-memory per-key rate limiter (sliding window). Used to cap live Gnani calls per client IP
 * on the public URL so visitors cannot drain the credit budget. Resets on process restart, which
 * is acceptable for a free-tier single instance; the ledger cap is the hard backstop.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Returns true if the call is allowed and records it. */
  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (arr.length >= this.limit) {
      this.hits.set(key, arr)
      return false
    }
    arr.push(now)
    this.hits.set(key, arr)
    return true
  }

  remaining(key: string, now = Date.now()): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    return Math.max(0, this.limit - arr.length)
  }
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? 'local'
}
