import { phoneDegrade, type PhoneOptions } from './phone'
import { analyzeDropouts, encodeWav, floatTo16, type DropoutReport } from './wav'

export const TARGET_RATE = 16000

/**
 * Push-to-talk microphone recorder producing 16 kHz mono 16-bit WAV.
 *
 * Uses MediaRecorder (the browser's own capture pipeline, which buffers reliably) and decodes the
 * result through an OfflineAudioContext at 16 kHz, which also performs the resampling. An earlier
 * AudioWorklet-based version dropped frames on some machines (exact-zero gaps inside speech), so
 * every take is now checked with `analyzeDropouts` and the report is returned to the caller.
 */
export class Recorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stopped: Promise<void> | null = null
  private resolveStopped: (() => void) | null = null

  async start(): Promise<void> {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    })
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined)
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.stopped = new Promise<void>((res) => (this.resolveStopped = res))
    this.rec.onstop = () => this.resolveStopped?.()
    this.rec.start(250)
  }

  /** Stop and return the WAV blob, duration, and a dropout report. Pass phone options to degrade the clip. */
  async stop(phone?: PhoneOptions | null): Promise<{ blob: Blob; seconds: number; report: DropoutReport }> {
    if (!this.rec || !this.stream) throw new Error('recorder not started')
    if (this.rec.state !== 'inactive') this.rec.stop()
    await this.stopped
    this.stream.getTracks().forEach((t) => t.stop())
    const encoded = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' })
    this.rec = null
    this.stream = null

    const arrayBuf = await encoded.arrayBuffer()
    // decode at native rate first (OfflineAudioContext needs a length; use a generous bound then trim)
    const probe = new AudioContext()
    const decoded = await probe.decodeAudioData(arrayBuf.slice(0))
    await probe.close()
    const length = Math.ceil(decoded.duration * TARGET_RATE)
    const off = new OfflineAudioContext(1, Math.max(1, length), TARGET_RATE)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    const rendered = await off.startRendering()
    let pcm: Float32Array = rendered.getChannelData(0)
    if (phone) pcm = phoneDegrade(pcm, TARGET_RATE, phone)
    const i16 = floatTo16(pcm)
    const report = analyzeDropouts(i16, TARGET_RATE)
    const blob = encodeWav(i16, TARGET_RATE)
    return { blob, seconds: pcm.length / TARGET_RATE, report }
  }
}
