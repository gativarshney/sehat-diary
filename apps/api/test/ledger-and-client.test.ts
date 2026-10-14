import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GnaniClient } from '../src/gnani'
import { CreditCapExceeded, Ledger } from '../src/ledger'
import { wavInfo } from '../src/wav'
import { tmp, wavBytes } from './helpers'

afterEach(() => vi.restoreAllMocks())

describe('ledger', () => {
  it('estimates, caps, persists', () => {
    const p = join(tmp(), 'l.csv')
    const led = new Ledger(p, { maxCredits: 1 })
    expect(led.estimate('stt_seconds', 60)).toBeCloseTo(0.45, 5)
    expect(led.estimate('tts_chars', 370)).toBeCloseTo(0.999, 3)
    led.record('t', '/stt/v3', 'stt_seconds', 60)
    expect(led.cumulative).toBeCloseTo(0.45, 5)
    led.reserve('stt_seconds', 60)
    expect(() => led.reserve('stt_seconds', 100)).toThrow(CreditCapExceeded)
    expect(new Ledger(p, { maxCredits: 1 }).cumulative).toBeCloseTo(0.45, 5)
  })
})

describe('wav', () => {
  it('reads duration', () => {
    expect(wavInfo(wavBytes(1.5)).seconds).toBeCloseTo(1.5, 3)
    expect(() => wavInfo(new TextEncoder().encode('nope nope nope nope nope nope nope nope nope nope'))).toThrow()
  })
})

describe('client', () => {
  it('mock mode makes no network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network call in mock mode')
    })
    const led = new Ledger(join(tmp(), 'l.csv'))
    const c = new GnaniClient({ mode: 'mock', ledger: led, mockTranscripts: { x: 'एक सौ बीस' } })
    const r = await c.transcribe(wavBytes(1), 'x')
    expect(r.mock).toBe(true)
    expect(r.transcript).toBe('एक सौ बीस')
    expect(new TextDecoder().decode(await c.synthesize('नमस्ते'))).toMatch(/^RIFF-mock/)
    expect(led.cumulative).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('live mode requires a key', () => {
    expect(() => new GnaniClient({ mode: 'live', apiKey: '', ledger: new Ledger(join(tmp(), 'l.csv')) })).toThrow()
  })

  it('live mode records to the ledger and sets the auth header', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      seen.push({ url: String(url), headers: init?.headers as Record<string, string> })
      return new Response(JSON.stringify({ success: true, transcript: 'एक सौ बीस', request_id: 'r1' }), { status: 200 })
    })
    const led = new Ledger(join(tmp(), 'l.csv'), { maxCredits: 1 })
    const c = new GnaniClient({ mode: 'live', apiKey: 'test-key-not-real', ledger: led })
    const r = await c.transcribe(wavBytes(2), 'x')
    expect(r.transcript).toBe('एक सौ बीस')
    expect(seen[0].url).toBe('https://api.vachana.ai/stt/v3')
    expect(seen[0].headers['X-API-Key-ID']).toBe('test-key-not-real')
    expect(led.cumulative).toBeCloseTo(0.015, 5)
  })
})
