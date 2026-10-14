import { describe, expect, it } from 'vitest'
import { RateLimiter, clientIp } from '../src/ratelimit'

describe('RateLimiter', () => {
  it('allows up to the limit within the window and then blocks', () => {
    const rl = new RateLimiter(3, 1000)
    expect(rl.allow('a', 0)).toBe(true)
    expect(rl.allow('a', 10)).toBe(true)
    expect(rl.allow('a', 20)).toBe(true)
    expect(rl.allow('a', 30)).toBe(false)
    expect(rl.remaining('a', 30)).toBe(0)
    expect(rl.allow('b', 30)).toBe(true)
    expect(rl.allow('a', 1001)).toBe(true) // window slid
  })
  it('extracts the client ip from proxy headers', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4')
    expect(clientIp(new Headers())).toBe('local')
  })
})
