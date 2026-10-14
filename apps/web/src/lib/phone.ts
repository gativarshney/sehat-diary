/**
 * "Phone mode": degrade a 16 kHz clip in the browser to approximate a noisy phone line,
 * so the same pipeline can be exercised under harder conditions without a telephony provider.
 *
 * - band-limit to roughly 300 to 3400 Hz (one-pole high-pass + two-pole low-pass)
 * - optional seeded noise bed (deterministic pseudo-random) at a chosen level
 *
 * Deterministic and dependency-free; the ffmpeg generator in bench/impair.ts is the reference for
 * benchmarks, this is for live demos and self-testing.
 */

export interface PhoneOptions {
  noiseLevel?: number // 0 = none, 0.05 = domestic-ish, 0.15 = street-ish (relative to full scale)
  seed?: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function phoneDegrade(input: Float32Array, sampleRate: number, opts: PhoneOptions = {}): Float32Array {
  const out = new Float32Array(input.length)
  // high-pass ~300 Hz (one pole)
  const hpAlpha = Math.exp((-2 * Math.PI * 300) / sampleRate)
  // low-pass ~3400 Hz, two cascaded one-pole stages
  const lpAlpha = Math.exp((-2 * Math.PI * 3400) / sampleRate)
  let hpPrevIn = 0
  let hpPrevOut = 0
  let lp1 = 0
  let lp2 = 0
  const rand = mulberry32(opts.seed ?? 42)
  const level = opts.noiseLevel ?? 0
  let brown = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
    hpPrevIn = x
    hpPrevOut = hp
    lp1 = (1 - lpAlpha) * hp + lpAlpha * lp1
    lp2 = (1 - lpAlpha) * lp1 + lpAlpha * lp2
    let y = lp2
    if (level > 0) {
      // mix of white and brown noise for a plausible hum-plus-hiss bed
      const white = rand() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      y += level * (0.6 * white * 0.3 + brown * 3.5)
    }
    out[i] = Math.max(-1, Math.min(1, y))
  }
  return out
}
