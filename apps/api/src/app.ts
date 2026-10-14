/**
 * Sehat Diary API: thin, key-holding proxy in front of Gnani plus the deterministic parser.
 *
 *   GET  /healthz
 *   POST /api/stt      multipart `audio` (wav, <= 25 s) -> { transcript, request_id, mock, seconds }
 *   POST /api/parse    { text } -> parse result
 *   POST /api/tts      { text, voice?, model?, language? } -> audio/wav (cached by content hash in live mode)
 *   GET  /api/ledger   { cumulative_est_credits, max_credits, mode }
 *
 * Mock mode (default) never touches the network. /api/stt accepts an optional `mock_text`
 * form field so the UI can be exercised without credits.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseNumbers } from 'hinglish-numbers'
import { CreditCapExceeded } from './ledger'
import { GnaniClient } from './gnani'
import { RateLimiter, clientIp } from './ratelimit'
import { wavInfo } from './wav'

function wavResponse(bytes: Uint8Array, headers: Record<string, string>): Response {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Response(new Blob([copy.buffer as ArrayBuffer], { type: 'audio/wav' }), { headers: { 'Content-Type': 'audio/wav', ...headers } })
}

export const MAX_CLIP_SECONDS = 25
export const SAMPLE_MOCK_TRANSCRIPT = 'बीपी एक सौ अट्ठाईस बाय बयासी'

export interface AppOptions {
  client: GnaniClient
  cacheDir: string
  corsOrigins?: string[]
  /** live calls allowed per client IP per hour (default 20); sample/mock paths are never limited */
  livePerIpPerHour?: number
}

export function buildApp(opts: AppOptions) {
  const { client, cacheDir } = opts
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const app = new Hono()
  app.use('*', cors({ origin: opts.corsOrigins ?? ['http://localhost:5173'] }))
  const limiter = new RateLimiter(opts.livePerIpPerHour ?? 20, 60 * 60 * 1000)
  const liveAllowed = (headers: Headers) => client.mode !== 'live' || limiter.allow(clientIp(headers))

  app.get('/healthz', (c) => c.json({ ok: true, mode: client.mode }))

  app.get('/api/ledger', (c) =>
    c.json({
      cumulative_est_credits: Number(client.ledger.cumulative.toFixed(5)),
      max_credits: client.ledger.maxCredits,
      mode: client.mode,
    }),
  )

  app.post('/api/parse', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null
    if (!body || typeof body.text !== 'string') return c.json({ error: 'text required' }, 400)
    const r = parseNumbers(body.text)
    return c.json({
      text: body.text,
      values: r.values,
      numbers: r.numbers,
      bp: r.bp,
      doubt: r.doubt,
      reasons: r.reasons,
      is_correction: r.isCorrection,
    })
  })

  app.post('/api/stt', async (c) => {
    const form = await c.req.parseBody()
    const audio = form['audio']
    if (!(audio instanceof File)) return c.json({ error: 'audio file required' }, 400)
    if (audio.size > 2_000_000) return c.json({ error: 'clip too large' }, 413)
    const bytes = new Uint8Array(await audio.arrayBuffer())
    let seconds: number
    try {
      seconds = wavInfo(bytes).seconds
    } catch {
      return c.json({ error: 'audio must be a WAV file' }, 400)
    }
    if (seconds > MAX_CLIP_SECONDS) return c.json({ error: `clip longer than ${MAX_CLIP_SECONDS} s` }, 400)
    const mockText = typeof form['mock_text'] === 'string' ? (form['mock_text'] as string) : undefined
    const languageCode = typeof form['language_code'] === 'string' ? (form['language_code'] as string) : 'hi-IN'
    if (client.mode !== 'live') {
      return c.json({ transcript: mockText || SAMPLE_MOCK_TRANSCRIPT, request_id: 'mock', mock: true, seconds })
    }
    if (!liveAllowed(c.req.raw.headers)) return c.json({ error: 'rate limit: try again later' }, 429)
    try {
      const biasList = (process.env.SEHAT_BIAS_LIST ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const r = await client.transcribe(bytes, 'api-clip', { languageCode, purpose: 'api-stt', biasList: biasList.length ? biasList : undefined })
      return c.json({ transcript: r.transcript, request_id: r.requestId, mock: false, seconds })
    } catch (e) {
      if (e instanceof CreditCapExceeded) return c.json({ error: String(e.message) }, 402)
      return c.json({ error: String((e as Error).message) }, 502)
    }
  })

  app.post('/api/tts', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { text?: unknown; voice?: string; model?: string; language?: string }
      | null
    if (!body || typeof body.text !== 'string' || !body.text.trim()) return c.json({ error: 'text required' }, 400)
    const voice = body.voice ?? process.env.SEHAT_TTS_VOICE ?? 'Nalini'
    const model = body.model ?? process.env.SEHAT_TTS_MODEL ?? 'timbre-v2.5'
    const language = body.language ?? process.env.SEHAT_TTS_LANGUAGE ?? 'hi-IN'
    const key = createHash('sha256').update(`${model}|${voice}|${language}|${body.text}`).digest('hex')
    const cached = join(cacheDir, `${key}.wav`)
    if (existsSync(cached)) {
      return wavResponse(readFileSync(cached), { 'X-Cache': 'hit', 'X-Mock': 'false' })
    }
    if (!liveAllowed(c.req.raw.headers)) return c.json({ error: 'rate limit: try again later' }, 429)
    try {
      const audio = await client.synthesize(body.text, { voice, model, language, purpose: 'api-tts' })
      if (client.mode === 'live') writeFileSync(cached, audio)
      return wavResponse(audio, { 'X-Cache': 'miss', 'X-Mock': String(client.mode !== 'live') })
    } catch (e) {
      if (e instanceof CreditCapExceeded) return c.json({ error: String(e.message) }, 402)
      return c.json({ error: String((e as Error).message) }, 502)
    }
  })

  return app
}
