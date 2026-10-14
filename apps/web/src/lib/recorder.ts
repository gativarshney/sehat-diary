import { phoneDegrade, type PhoneOptions } from './phone'
import { encodeWav, floatTo16, resample } from './wav'

export const TARGET_RATE = 16000

/**
 * Push-to-talk microphone recorder producing 16 kHz mono 16-bit WAV.
 * Uses an AudioWorklet (inline module) to collect Float32 frames, then resamples
 * to 16 kHz on stop. Echo cancellation and noise suppression are requested from the
 * browser so playback of the app's own voice is less likely to be captured.
 */
export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private chunks: Float32Array[] = []
  private startedAt = 0
  private inputRate = TARGET_RATE
  private _level = 0

  get level(): number {
    return this._level
  }

  async start(): Promise<void> {
    this.chunks = []
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.ctx = new AudioContext()
    this.inputRate = this.ctx.sampleRate
    const workletSrc = `
      class PcmTap extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch) this.port.postMessage(ch.slice(0));
          return true;
        }
      }
      registerProcessor('pcm-tap', PcmTap);`
    const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data
      this.chunks.push(f)
      let sum = 0
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i]
      this._level = Math.sqrt(sum / f.length)
    }
    src.connect(this.node)
    // Do not connect the node to destination: we never play the mic back.
    this.startedAt = performance.now()
  }

  /** Stop and return the WAV blob plus duration in seconds. Pass phone options to degrade the clip. */
  async stop(phone?: PhoneOptions | null): Promise<{ blob: Blob; seconds: number }> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const merged = new Float32Array(total)
    let off = 0
    for (const c of this.chunks) {
      merged.set(c, off)
      off += c.length
    }
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.node = null
    this.stream = null
    this.ctx = null
    let pcm = resample(merged, this.inputRate, TARGET_RATE)
    if (phone) pcm = phoneDegrade(pcm, TARGET_RATE, phone)
    const blob = encodeWav(floatTo16(pcm), TARGET_RATE)
    const seconds = pcm.length / TARGET_RATE
    void this.startedAt
    return { blob, seconds }
  }
}
