import { floatTo16, resample } from './wav'

export interface StreamEvent {
  type: string
  text?: string
  segment_index?: number
  connection?: number
  message?: string
  latency?: number
}

/**
 * Browser streaming client for the realtime STT proxy (/ws/stt).
 * Captures the microphone, resamples to 16 kHz, and sends exact 1,024-byte PCM frames as the
 * microphone produces them (real-time cadence by construction). Transcript segments arrive as
 * JSON events; the caller decides when the utterance is complete (push-to-talk stop).
 */
export class StreamClient {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private carry = new Int16Array(0)
  private inputRate = 16000
  readonly segments: { index: number; connection: number; text: string; latency?: number }[] = []
  onEvent: (e: StreamEvent) => void = () => {}
  onClose: (code: number, reason: string) => void = () => {}

  private wsBase: string
  private lang: string

  constructor(wsBase: string, lang = 'hi-IN') {
    this.wsBase = wsBase
    this.lang = lang
  }

  async start(): Promise<void> {
    const url = `${this.wsBase}/ws/stt?lang=${encodeURIComponent(this.lang)}&rate=16000`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    await new Promise<void>((res, rej) => {
      this.ws!.onopen = () => res()
      this.ws!.onerror = () => rej(new Error('stream connect failed'))
    })
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      const e = JSON.parse(ev.data) as StreamEvent
      if (e.type === 'transcript' && e.text) {
        const seg = { index: e.segment_index ?? this.segments.length, connection: e.connection ?? 0, text: e.text, latency: e.latency }
        // dedupe on (connection, index); an upstream reconnect restarts indices
        if (!this.segments.some((s) => s.connection === seg.connection && s.index === seg.index)) this.segments.push(seg)
      }
      this.onEvent(e)
    }
    this.ws.onclose = (ev) => this.onClose(ev.code, ev.reason)

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.ctx = new AudioContext()
    this.inputRate = this.ctx.sampleRate
    const workletSrc = `class PcmTap extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; } } registerProcessor('pcm-tap-stream', PcmTap);`
    const blobUrl = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(blobUrl)
    URL.revokeObjectURL(blobUrl)
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap-stream')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data)
    src.connect(this.node)
  }

  private push(frame: Float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const pcm = floatTo16(resample(frame, this.inputRate, 16000))
    const merged = new Int16Array(this.carry.length + pcm.length)
    merged.set(this.carry)
    merged.set(pcm, this.carry.length)
    const samplesPerFrame = 512 // 1,024 bytes
    let off = 0
    while (merged.length - off >= samplesPerFrame) {
      this.ws.send(merged.slice(off, off + samplesPerFrame).buffer)
      off += samplesPerFrame
    }
    this.carry = merged.slice(off)
  }

  /** Stop capturing; wait briefly for the final segment; return the joined transcript. */
  async stop(graceMs = 1200): Promise<string> {
    // send ~1 s of trailing silence so server-side VAD closes the last segment
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const silence = new ArrayBuffer(1024)
      for (let i = 0; i < 32; i++) this.ws.send(silence)
    }
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    await new Promise((r) => setTimeout(r, graceMs))
    this.ws?.close(1000, 'done')
    this.ws = null
    this.node = null
    this.stream = null
    this.ctx = null
    return this.segments
      .sort((a, b) => a.connection - b.connection || a.index - b.index)
      .map((s) => s.text)
      .join(' ')
  }
}

export function wsBaseFromApiBase(apiBase: string): string {
  if (apiBase) return apiBase.replace(/^http/, 'ws')
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}`
}
