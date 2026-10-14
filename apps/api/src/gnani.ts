/**
 * Minimal Gnani REST client with a mock mode.
 *
 * Endpoints (docs.gnani.ai, checked 2026-10-14):
 * - STT REST: POST https://api.vachana.ai/stt/v3 (multipart: audio_file, language_code, format, ...)
 * - TTS REST: POST https://api.vachana.ai/api/v1/tts/inference (JSON: text, voice, model, language, audio_config)
 * Auth header: X-API-Key-ID. A real User-Agent is set because Cloudflare blocks default library agents.
 */
import { Ledger } from './ledger'
import { wavInfo } from './wav'

export const BASE = 'https://api.vachana.ai'
export const USER_AGENT = 'sehat-diary/0.1 (+https://github.com/gativarshney/sehat-diary)'

export type Mode = 'mock' | 'live'

export interface SttOptions {
  languageCode?: string
  format?: 'verbatim' | 'transcribe'
  itnNativeNumerals?: boolean
  biasList?: string[]
  biasScore?: number
  purpose?: string
}

export interface SttResult {
  transcript: string
  requestId: string | null
  raw: unknown
  mock: boolean
  seconds: number
}

export interface TtsOptions {
  voice?: string
  model?: string
  language?: string
  speed?: number
  sampleRate?: number
  purpose?: string
}

export class GnaniClient {
  readonly mode: Mode
  readonly ledger: Ledger
  private readonly apiKey: string
  private readonly mockTranscripts: Record<string, string>

  constructor(opts: { mode?: Mode; apiKey?: string; ledger: Ledger; mockTranscripts?: Record<string, string> }) {
    this.mode = opts.mode ?? ((process.env.GNANI_MODE as Mode) || 'mock')
    this.apiKey = opts.apiKey ?? process.env.GNANI_API_KEY ?? ''
    this.ledger = opts.ledger
    this.mockTranscripts = opts.mockTranscripts ?? {}
    if (this.mode === 'live' && !this.apiKey) throw new Error('GNANI_MODE=live but GNANI_API_KEY is empty')
  }

  /** Transcribe a WAV clip. `name` is used to look up a mock transcript in mock mode. */
  async transcribe(wav: Uint8Array, name = 'clip', o: SttOptions = {}): Promise<SttResult> {
    const { seconds } = wavInfo(wav)
    if (this.mode !== 'live') {
      const text = this.mockTranscripts[name] ?? `[mock transcript for ${name}]`
      return { transcript: text, requestId: 'mock', raw: { mock: true }, mock: true, seconds }
    }
    this.ledger.reserve('stt_seconds', seconds)
    const fd = new FormData()
    const copy = new Uint8Array(wav.byteLength)
    copy.set(wav)
    fd.append('audio_file', new Blob([copy.buffer as ArrayBuffer], { type: 'audio/wav' }), `${name}.wav`)
    fd.append('language_code', o.languageCode ?? 'hi-IN')
    fd.append('format', o.format ?? 'transcribe')
    fd.append('itn_native_numerals', String(o.itnNativeNumerals ?? false))
    if (o.biasList?.length) {
      fd.append('bias_list', JSON.stringify(o.biasList))
      fd.append('bias_score', String(o.biasScore ?? 1.0))
    }
    const r = await fetch(`${BASE}/stt/v3`, {
      method: 'POST',
      headers: { 'X-API-Key-ID': this.apiKey, 'User-Agent': USER_AGENT },
      body: fd,
    })
    this.ledger.record(o.purpose ?? 'stt', '/stt/v3', 'stt_seconds', seconds, `${name} status=${r.status}`)
    const text = await r.text()
    let body: { success?: boolean; transcript?: string; request_id?: string } & Record<string, unknown>
    try {
      body = JSON.parse(text)
    } catch {
      body = { success: false, status: r.status, text: text.slice(0, 500) }
    }
    if (!r.ok || !body.success) throw new Error(`STT failed ${r.status}: ${JSON.stringify(body).slice(0, 400)}`)
    return { transcript: body.transcript ?? '', requestId: body.request_id ?? null, raw: body, mock: false, seconds }
  }

  async synthesize(text: string, o: TtsOptions = {}): Promise<Uint8Array> {
    if (this.mode !== 'live') return new TextEncoder().encode(`RIFF-mock-wav:${text}`)
    this.ledger.reserve('tts_chars', text.length)
    const r = await fetch(`${BASE}/api/v1/tts/inference`, {
      method: 'POST',
      headers: { 'X-API-Key-ID': this.apiKey, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: o.voice ?? 'Nalini',
        model: o.model ?? 'timbre-v2.5',
        language: o.language ?? 'hi-IN',
        speed: o.speed ?? 1.0,
        audio_config: { sample_rate: o.sampleRate ?? 16000, num_channels: 1, sample_width: 2, encoding: 'linear_pcm', container: 'wav' },
      }),
    })
    this.ledger.record(o.purpose ?? 'tts', '/api/v1/tts/inference', 'tts_chars', text.length, `voice=${o.voice ?? 'Nalini'} status=${r.status}`)
    if (!r.ok) throw new Error(`TTS failed ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return new Uint8Array(await r.arrayBuffer())
  }
}
