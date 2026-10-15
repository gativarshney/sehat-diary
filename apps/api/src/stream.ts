/**
 * Realtime STT proxy: browser WebSocket  <->  this server  <->  Gnani /stt/v3/stream.
 *
 * Why a proxy: browsers cannot set the `x-api-key-id` upgrade header, and the key must never
 * reach the client. The server also enforces the documented framing (exactly 1,024-byte PCM
 * frames), bills the ledger by audio seconds forwarded, applies the per-IP limit and the credit
 * cap, reconnects upstream with backoff if the upstream drops mid-session, and caps the session
 * below Gnani's 15-minute limit.
 *
 * Client protocol (JSON text frames from server, binary PCM s16le mono frames from client):
 *   -> { type: 'ready', mode, connection }           proxy ready (upstream connected or mock)
 *   -> { type: 'processing' | 'transcript' | ... }   relayed from upstream, plus `connection` number
 *   -> { type: 'reconnected', connection }           upstream dropped and was re-established
 *   -> { type: 'error', message }                    relayed or local error
 *   close codes: 4401 unauthorised, 4402 credit cap, 4429 rate limit, 4408 session limit
 */
import type { IncomingMessage } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { USER_AGENT } from './gnani'
import { Ledger } from './ledger'
import { RateLimiter, clientIp } from './ratelimit'

export const FRAME_BYTES = 1024
export const SESSION_MAX_MS = 14 * 60 * 1000
export const UPSTREAM_URL = 'wss://api.vachana.ai/stt/v3/stream'

export interface StreamOptions {
  mode: 'mock' | 'live'
  apiKey?: string
  ledger: Ledger
  limiter?: RateLimiter
  upstreamUrl?: string // overridable for tests
  path?: string
  maxReconnects?: number
  /** VAD preset headers; defaults follow the docs' "clean web microphone" preset at 16 kHz */
  vad?: Record<string, string>
  /** mock transcript to emit per ~1 s of audio in mock mode */
  mockTranscript?: string
  biasList?: string[]
  biasScore?: number
  substitutions?: { patterns: string[]; replacement: string }[]
}

export function attachStreamProxy(server: HttpServer, opts: StreamOptions): WebSocketServer {
  const wss = new WebSocketServer({ server, path: opts.path ?? '/ws/stt' })
  const limiter = opts.limiter ?? new RateLimiter(20, 60 * 60 * 1000)
  const maxReconnects = opts.maxReconnects ?? 3

  wss.on('connection', (client: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const lang = url.searchParams.get('lang') ?? 'hi-IN'
    const rate = Number(url.searchParams.get('rate') ?? '16000')
    if (![8000, 16000, 44100, 48000].includes(rate)) {
      client.close(4400, 'bad sample rate')
      return
    }
    if (opts.mode === 'live' && !limiter.allow(clientIp(new Headers(req.headers as Record<string, string>)))) {
      client.close(4429, 'rate limit')
      return
    }
    if (opts.mode === 'live' && !opts.apiKey) {
      client.close(4401, 'no key configured')
      return
    }

    const session = new Session(client, { ...opts, lang, rate, maxReconnects })
    session.start()
  })
  return wss
}

interface SessionOpts extends StreamOptions {
  lang: string
  rate: number
  maxReconnects: number
}

class Session {
  private upstream: WebSocket | null = null
  private pending = Buffer.alloc(0)
  private bytesForwarded = 0
  private billedSeconds = 0
  private connection = 0
  private reconnects = 0
  private closed = false
  private timer: NodeJS.Timeout
  private mockBytes = 0

  constructor(
    private client: WebSocket,
    private o: SessionOpts,
  ) {
    this.timer = setTimeout(() => this.close(4408, 'session limit'), SESSION_MAX_MS)
  }

  start() {
    this.client.on('message', (data: RawData, isBinary: boolean) => this.onClient(data, isBinary))
    this.client.on('close', () => this.teardown())
    this.client.on('error', () => this.teardown())
    if (this.o.mode !== 'live') {
      this.send({ type: 'ready', mode: 'mock', connection: 0 })
      return
    }
    this.connectUpstream()
  }

  private send(obj: Record<string, unknown>) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(obj))
  }

  private connectUpstream() {
    if (this.closed) return
    this.connection++
    const headers: Record<string, string> = {
      'x-api-key-id': this.o.apiKey!,
      lang_code: this.o.lang,
      'x-sample-rate': String(this.o.rate),
      'x-format': 'transcribe',
      'User-Agent': USER_AGENT,
      'x-vad-threshold': '0.5',
      'x-min-silence-ms': '700',
      ...(this.o.vad ?? {}),
    }
    if (this.o.biasList?.length) {
      headers['x-bias-list'] = this.o.biasList.join(',')
      headers['x-bias-score'] = String(this.o.biasScore ?? 1.0)
    }
    if (this.o.substitutions?.length) {
      headers['x-enable-substitution'] = 'true'
      headers['x-substitution-map'] = JSON.stringify(this.o.substitutions.slice(0, 10))
    }
    const up = new WebSocket(this.o.upstreamUrl ?? UPSTREAM_URL, { headers })
    this.upstream = up
    const conn = this.connection
    up.on('open', () => {
      this.send({ type: conn === 1 ? 'ready' : 'reconnected', mode: 'live', connection: conn })
      this.flush()
    })
    up.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>
        if (msg.type === 'connected') return // already signalled as ready
        this.send({ ...msg, connection: conn })
      } catch {
        /* ignore malformed upstream frame */
      }
    })
    up.on('close', (code: number, reason: Buffer) => {
      if (this.closed || this.upstream !== up) return
      this.upstream = null
      if (this.reconnects < this.o.maxReconnects) {
        const delay = Math.min(4000, 500 * 2 ** this.reconnects) + Math.floor(Math.random() * 200)
        this.reconnects++
        this.send({ type: 'upstream_closed', code, reason: reason.toString(), retry_in_ms: delay })
        setTimeout(() => this.connectUpstream(), delay)
      } else {
        this.close(1011, 'upstream unavailable')
      }
    })
    up.on('error', () => {
      /* close handler decides what to do */
    })
  }

  private onClient(data: RawData, isBinary: boolean) {
    if (!isBinary) return // no client control frames in v1
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
    this.pending = Buffer.concat([this.pending, buf])
    this.flush()
  }

  /** Re-chunk into exact 1,024-byte frames; bill by audio seconds; forward (or mock). */
  private flush() {
    while (this.pending.length >= FRAME_BYTES) {
      const frame = this.pending.subarray(0, FRAME_BYTES)
      this.pending = this.pending.subarray(FRAME_BYTES)
      const seconds = FRAME_BYTES / (this.o.rate * 2)
      if (this.o.mode === 'live') {
        if (!this.upstream || this.upstream.readyState !== WebSocket.OPEN) {
          // keep at most ~2 s buffered while reconnecting, then drop oldest
          this.pending = Buffer.concat([frame, this.pending]).subarray(-this.o.rate * 4)
          return
        }
        // project the cap over recorded usage plus not-yet-recorded seconds in this session
        const unbilled = this.billedSeconds - this.lastRecorded + seconds
        if (this.o.ledger.cumulative + this.o.ledger.estimate('stt_seconds', unbilled) > this.o.ledger.maxCredits) {
          this.close(4402, 'credit cap')
          return
        }
        this.upstream.send(frame)
        this.bytesForwarded += FRAME_BYTES
        this.billedSeconds += seconds
        if (this.billedSeconds - this.lastRecorded >= 5) this.recordUsage()
      } else {
        this.mockBytes += FRAME_BYTES
        if (this.mockBytes >= this.o.rate * 2) {
          this.mockBytes = 0
          this.send({ type: 'processing', connection: 0, timestamp: new Date().toISOString() })
          this.send({
            type: 'transcript',
            text: this.o.mockTranscript ?? 'बीपी एक सौ अट्ठाईस बाय बयासी',
            audio_duration_ms: 1000,
            segment_id: `mock-${Date.now()}`,
            segment_index: this.mockSegments++,
            latency: 0,
            connection: 0,
          })
        }
      }
    }
  }
  private mockSegments = 0
  private lastRecorded = 0

  private recordUsage() {
    const delta = this.billedSeconds - this.lastRecorded
    if (delta > 0) this.o.ledger.record('stream', '/stt/v3/stream', 'stt_seconds', delta, `conn=${this.connection}`)
    this.lastRecorded = this.billedSeconds
  }

  private close(code: number, reason: string) {
    if (this.closed) return
    this.closed = true
    if (this.client.readyState === WebSocket.OPEN) this.client.close(code, reason)
    this.teardown()
  }

  private teardown() {
    if (this.o.mode === 'live') this.recordUsage()
    this.closed = true
    clearTimeout(this.timer)
    const up = this.upstream
    this.upstream = null
    if (up && (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING)) up.close()
  }

  get stats() {
    return { bytesForwarded: this.bytesForwarded, billedSeconds: this.billedSeconds, connection: this.connection }
  }
}
