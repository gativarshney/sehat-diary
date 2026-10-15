import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { Ledger } from '../src/ledger'
import { RateLimiter } from '../src/ratelimit'
import { FRAME_BYTES, asciiJson, attachStreamProxy } from '../src/stream'
import { tmp } from './helpers'

const servers: Server[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()))
})

function listen(server: Server): Promise<number> {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res((server.address() as { port: number }).port)))
}

/** Minimal stand-in for Gnani's stream endpoint: records headers, emits connected, then a transcript per second of audio. */
async function mockUpstream(opts: { dropAfterBytes?: number } = {}) {
  const server = createServer()
  servers.push(server)
  const wss = new WebSocketServer({ server })
  const seen: { headers: Record<string, string | string[] | undefined>; bytes: number; frames: number[] }[] = []
  wss.on('connection', (ws, req) => {
    const rec = { headers: req.headers, bytes: 0, frames: [] as number[] }
    seen.push(rec)
    ws.send(JSON.stringify({ type: 'connected', message: 'ok', config: { sample_rate: 16000, chunk_size: 512 } }))
    let since = 0
    let idx = 0
    ws.on('message', (d: Buffer) => {
      rec.bytes += d.length
      rec.frames.push(d.length)
      since += d.length
      if (opts.dropAfterBytes && rec.bytes >= opts.dropAfterBytes) {
        ws.close(1011, 'simulated drop')
        return
      }
      if (since >= 32000) {
        since = 0
        ws.send(JSON.stringify({ type: 'processing', timestamp: 't' }))
        ws.send(JSON.stringify({ type: 'transcript', text: 'एक सौ बीस', audio_duration_ms: 1000, segment_id: 's', segment_index: idx++, latency: 50 }))
      }
    })
  })
  const port = await listen(server)
  return { url: `ws://127.0.0.1:${port}`, seen }
}

async function proxy(opts: Partial<Parameters<typeof attachStreamProxy>[1]> & { upstreamUrl?: string }) {
  const server = createServer()
  servers.push(server)
  const ledger = new Ledger(join(tmp(), 'l.csv'), { maxCredits: opts.ledger?.maxCredits ?? 1 })
  attachStreamProxy(server, { mode: 'live', apiKey: 'test-key-not-real', ledger, ...opts })
  const port = await listen(server)
  return { url: `ws://127.0.0.1:${port}/ws/stt?lang=hi-IN&rate=16000`, ledger }
}

function collect(ws: WebSocket) {
  const msgs: Record<string, unknown>[] = []
  ws.on('message', (d: Buffer, isBinary: boolean) => {
    if (!isBinary) msgs.push(JSON.parse(d.toString()))
  })
  return msgs
}

const until = (f: () => boolean, ms = 3000) =>
  new Promise<void>((res, rej) => {
    const t0 = Date.now()
    const i = setInterval(() => {
      if (f()) {
        clearInterval(i)
        res()
      } else if (Date.now() - t0 > ms) {
        clearInterval(i)
        rej(new Error('timeout'))
      }
    }, 10)
  })

describe('stream proxy', () => {
  it('sets auth headers upstream, re-chunks to 1024-byte frames, relays transcripts, bills seconds', async () => {
    const up = await mockUpstream()
    const { url, ledger } = await proxy({ upstreamUrl: up.url })
    const ws = new WebSocket(url)
    const msgs = collect(ws)
    await until(() => msgs.some((m) => m.type === 'ready'))
    // send 2 s of audio as odd-sized chunks
    const total = 64000
    let sent = 0
    while (sent < total) {
      const n = Math.min(700, total - sent)
      ws.send(Buffer.alloc(n))
      sent += n
    }
    await until(() => msgs.filter((m) => m.type === 'transcript').length >= 1)
    expect(up.seen[0].headers['x-api-key-id']).toBe('test-key-not-real')
    expect(up.seen[0].headers['lang_code']).toBe('hi-IN')
    expect(up.seen[0].headers['x-sample-rate']).toBe('16000')
    expect(up.seen[0].frames.every((f) => f === FRAME_BYTES)).toBe(true)
    expect(msgs.find((m) => m.type === 'transcript')).toMatchObject({ text: 'एक सौ बीस', connection: 1 })
    ws.close()
    await until(() => ledger.cumulative > 0)
    expect(ledger.cumulative).toBeCloseTo((Math.floor(total / FRAME_BYTES) * FRAME_BYTES) / 32000 * 0.0075, 4)
  })

  it('closes with 4402 before exceeding the credit cap', async () => {
    const up = await mockUpstream()
    const ledgerCap = new Ledger(join(tmp(), 'l.csv'), { maxCredits: 0.01 }) // ~1.3 s of audio
    const { url } = await proxy({ upstreamUrl: up.url, ledger: ledgerCap })
    const ws = new WebSocket(url)
    const msgs = collect(ws)
    let code = 0
    ws.on('close', (c) => (code = c))
    await until(() => msgs.some((m) => m.type === 'ready'))
    ws.send(Buffer.alloc(64000))
    await until(() => code !== 0)
    expect(code).toBe(4402)
  })

  it('reconnects upstream after a drop and tags messages with the connection number', async () => {
    const up = await mockUpstream({ dropAfterBytes: 4096 })
    const { url } = await proxy({ upstreamUrl: up.url, maxReconnects: 2 })
    const ws = new WebSocket(url)
    const msgs = collect(ws)
    await until(() => msgs.some((m) => m.type === 'ready'))
    ws.send(Buffer.alloc(8192))
    await until(() => msgs.some((m) => m.type === 'reconnected'), 6000)
    expect(up.seen.length).toBeGreaterThanOrEqual(2)
    expect(msgs.find((m) => m.type === 'reconnected')).toMatchObject({ connection: 2 })
    ws.close()
  })

  it('rate-limits live connections per ip', async () => {
    const up = await mockUpstream()
    const { url } = await proxy({ upstreamUrl: up.url, limiter: new RateLimiter(1, 60_000) })
    const a = new WebSocket(url)
    const am = collect(a)
    await until(() => am.some((m) => m.type === 'ready'))
    const b = new WebSocket(url)
    let code = 0
    b.on('close', (c) => (code = c))
    await until(() => code !== 0)
    expect(code).toBe(4429)
    a.close()
  })

  it('sends a Devanagari substitution map as an ASCII-only header and still connects', async () => {
    const up = await mockUpstream()
    const subs = [{ patterns: ['बटासी'], replacement: 'बटा अस्सी' }]
    expect(/^[\x00-\x7f]*$/.test(asciiJson(subs))).toBe(true)
    expect(JSON.parse(asciiJson(subs))).toEqual(subs)
    const { url } = await proxy({ upstreamUrl: up.url, substitutions: subs, biasList: ['sugar', 'dawai'] })
    const ws = new WebSocket(url)
    const msgs = collect(ws)
    await until(() => msgs.some((m) => m.type === 'ready'))
    expect(up.seen[0].headers['x-enable-substitution']).toBe('true')
    expect(JSON.parse(String(up.seen[0].headers['x-substitution-map']))).toEqual(subs)
    expect(up.seen[0].headers['x-bias-list']).toBe('sugar,dawai')
    ws.close()
  })

  it('mock mode emits synthetic transcripts without any upstream', async () => {
    const { url, ledger } = await proxy({ mode: 'mock', mockTranscript: 'शुगर सवा सौ' })
    const ws = new WebSocket(url)
    const msgs = collect(ws)
    await until(() => msgs.some((m) => m.type === 'ready'))
    ws.send(Buffer.alloc(32768))
    await until(() => msgs.some((m) => m.type === 'transcript'))
    expect(msgs.find((m) => m.type === 'transcript')).toMatchObject({ text: 'शुगर सवा सौ', connection: 0 })
    expect(ledger.cumulative).toBe(0)
    ws.close()
  })
})
