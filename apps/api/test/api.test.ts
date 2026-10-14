import { describe, expect, it } from 'vitest'
import { mockApp, wavBytes } from './helpers'

function form(audio: Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('audio', new Blob([audio.buffer], { type: 'audio/wav' }), 'a.wav')
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

describe('api', () => {
  it('health and ledger', async () => {
    const { app } = mockApp()
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true, mode: 'mock' })
    const led = await (await app.request('/api/ledger')).json()
    expect(led.cumulative_est_credits).toBe(0)
    expect(led.mode).toBe('mock')
  })

  it('parse endpoint', async () => {
    const { app } = mockApp()
    const r = await (
      await app.request('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'sugar fasting dedh sau' }) })
    ).json()
    expect(r.values).toEqual([150])
    expect(r.doubt).toBe(true)
    expect(r.reasons).toContain('fraction word')
    const r2 = await (
      await app.request('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'BP ek sau atthais by bayasi' }) })
    ).json()
    expect(r2.bp).toEqual([128, 82])
    expect(r2.doubt).toBe(false)
    expect((await app.request('/api/parse', { method: 'POST', body: '{}' })).status).toBe(400)
  })

  it('stt in mock mode uses mock_text and spends nothing', async () => {
    const { app, ledger } = mockApp()
    const res = await app.request('/api/stt', { method: 'POST', body: form(wavBytes(2), { mock_text: 'शुगर सवा सौ' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mock).toBe(true)
    expect(body.transcript).toBe('शुगर सवा सौ')
    expect(Math.abs(body.seconds - 2)).toBeLessThan(0.01)
    expect(ledger.cumulative).toBe(0)
  })

  it('stt rejects long clips and non-wav input', async () => {
    const { app } = mockApp()
    expect((await app.request('/api/stt', { method: 'POST', body: form(wavBytes(26)) })).status).toBe(400)
    const notWav = new Uint8Array(new ArrayBuffer(9))
    notWav.set(new TextEncoder().encode('not a wav'))
    expect((await app.request('/api/stt', { method: 'POST', body: form(notWav) })).status).toBe(400)
    expect((await app.request('/api/stt', { method: 'POST', body: new FormData() })).status).toBe(400)
  })

  it('tts in mock mode returns audio without credits', async () => {
    const { app, ledger } = mockApp()
    const res = await app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'नमस्ते' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/wav')
    expect(res.headers.get('x-mock')).toBe('true')
    expect(ledger.cumulative).toBe(0)
    expect((await app.request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }) })).status).toBe(400)
  })
})
