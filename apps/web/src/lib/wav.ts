/** Encode 16-bit mono PCM samples as a WAV file. */
export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const byteLength = samples.length * 2
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + byteLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeStr(36, 'data')
  v.setUint32(40, byteLength, true)
  return new Blob([header, samples.buffer as ArrayBuffer], { type: 'audio/wav' })
}

/** Float32 [-1,1] to Int16 with clipping. */
export function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Linear resample Float32 audio from `from` Hz to `to` Hz. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const n = Math.floor(input.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

export interface DropoutReport {
  seconds: number
  peak: number // 0..32767
  speechStart: number // seconds
  speechEnd: number
  zeroWindows: number // 20 ms windows of exact digital zero inside the speech region
  longestGapMs: number
  ok: boolean
  reason?: string
}

/**
 * Detects capture dropouts: runs of exact digital zeros inside the speech region. Natural pauses
 * contain microphone noise and never hit exact zero for 20 ms, so zero windows mean lost audio.
 */
export function analyzeDropouts(samples: Int16Array, rate: number): DropoutReport {
  const win = Math.floor(rate / 50)
  const n = Math.floor(samples.length / win)
  const rms: number[] = []
  const zero: boolean[] = []
  let peak = 0
  for (let i = 0; i < n; i++) {
    let sum = 0
    let allZero = true
    for (let j = i * win; j < (i + 1) * win; j++) {
      const v = samples[j]
      sum += v * v
      if (v !== 0) allZero = false
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    rms.push(Math.sqrt(sum / win))
    zero.push(allZero)
  }
  const active = rms.map((r) => r > 300)
  const first = active.indexOf(true)
  const last = active.lastIndexOf(true)
  const seconds = samples.length / rate
  if (first < 0) return { seconds, peak, speechStart: 0, speechEnd: 0, zeroWindows: 0, longestGapMs: 0, ok: false, reason: 'no speech detected (too quiet?)' }
  let zeroWindows = 0
  let run = 0
  let longest = 0
  for (let i = first; i <= last; i++) {
    if (zero[i]) {
      zeroWindows++
      run++
      if (run > longest) longest = run
    } else run = 0
  }
  const report: DropoutReport = {
    seconds,
    peak,
    speechStart: first * 0.02,
    speechEnd: (last + 1) * 0.02,
    zeroWindows,
    longestGapMs: longest * 20,
    ok: true,
  }
  if (zeroWindows > 2) {
    report.ok = false
    report.reason = `audio dropped out ${zeroWindows} times (longest ${longest * 20} ms); re-record`
  } else if (peak > 32000) {
    report.ok = false
    report.reason = 'clipping (too loud); move the mic further away and re-record'
  } else if (seconds < 1.5) {
    report.ok = false
    report.reason = 'too short'
  }
  return report
}
