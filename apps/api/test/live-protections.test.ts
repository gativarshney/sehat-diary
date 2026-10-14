import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app'
import { GnaniClient } from '../src/gnani'
import { Ledger } from '../src/ledger'
import { tmp, wavBytes } from './helpers'

afterEach(() => vi.restoreAllMocks())

function liveApp(opts: { maxCredits?: number; perIp?: number } = {}) {
  const dir = tmp()
  const ledger = new Ledger(join(dir, 'ledger.csv'), { maxCredits: opts.maxCredits ?? 1 })
  const client = new GnaniClient({ mode: 'live', apiKey: 'test-key-not-real', ledger })
  const app = buildApp({ client, cacheDir: join(dir, 'tts'), livePerIpPerHour: opts.perIp ?? 2 })
  return { app, ledger }
}

function sttForm(seconds = 1) {
  const fd = new FormData()
  fd.append('audio', new Blob([wavBytes(seconds).buffer], { type: 'audio/wav' }), 'a.wav')
  return fd
}

describe('live-mode protections', () => {
  it('rate-limits live STT per client ip and never calls Gnani once limited', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ success: true, transcript: 'एक सौ बीस' }), { status: 200 }),
    )
    const { app } = liveApp({ perIp: 2 })
    const h = { 'x-forwarded-for': '9.9.9.9' }
    expect((await app.request('/api/stt', { method: 'POST', body: sttForm(), headers: h })).status).toBe(200)
    expect((await app.request('/api/stt', { method: 'POST', body: sttForm(), headers: h })).status).toBe(200)
    const third = await app.request('/api/stt', { method: 'POST', body: sttForm(), headers: h })
    expect(third.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // a different visitor is still allowed
    expect((await app.request('/api/stt', { method: 'POST', body: sttForm(), headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(200)
  })

  it('refuses with 402 when the credit cap would be exceeded, before calling Gnani', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { app, ledger } = liveApp({ maxCredits: 0.001, perIp: 10 })
    const r = await app.request('/api/stt', { method: 'POST', body: sttForm(10) })
    expect(r.status).toBe(402)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ledger.cumulative).toBe(0)
  })

  it('caches live TTS by content so repeat read-backs cost nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 }))
    const { app, ledger } = liveApp({ perIp: 10 })
    const text = 'बीपी 128 बाय 82, सही है?'
    const body = JSON.stringify({ text })
    const h = { 'Content-Type': 'application/json' }
    const first = await app.request('/api/tts', { method: 'POST', body, headers: h })
    expect(first.headers.get('x-cache')).toBe('miss')
    const second = await app.request('/api/tts', { method: 'POST', body, headers: h })
    expect(second.headers.get('x-cache')).toBe('hit')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(ledger.cumulative).toBeCloseTo(text.length * 0.0027, 4)
  })

  it('maps upstream failures to 502 without leaking the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"success":false,"error":{"type":"API_ERROR"}}', { status: 500 }))
    const { app } = liveApp({ perIp: 10 })
    const r = await app.request('/api/stt', { method: 'POST', body: sttForm() })
    expect(r.status).toBe(502)
    expect(await r.text()).not.toContain('test-key-not-real')
  })
})
