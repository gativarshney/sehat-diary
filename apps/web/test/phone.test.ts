import { describe, expect, it } from 'vitest'
import { phoneDegrade } from '../src/lib/phone'

function tone(freq: number, rate: number, seconds: number): Float32Array {
  const n = Math.round(rate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

function rms(x: Float32Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}

describe('phoneDegrade', () => {
  it('passes voice band and attenuates out-of-band tones', () => {
    const rate = 16000
    const inBand = rms(phoneDegrade(tone(1000, rate, 1), rate))
    const low = rms(phoneDegrade(tone(80, rate, 1), rate))
    const high = rms(phoneDegrade(tone(7000, rate, 1), rate))
    expect(inBand).toBeGreaterThan(0.25)
    expect(low).toBeLessThan(inBand * 0.5)
    expect(high).toBeLessThan(inBand * 0.5)
  })
  it('adds a deterministic noise bed', () => {
    const rate = 16000
    const silence = new Float32Array(rate)
    const a = phoneDegrade(silence, rate, { noiseLevel: 0.1, seed: 7 })
    const b = phoneDegrade(silence, rate, { noiseLevel: 0.1, seed: 7 })
    expect(rms(a)).toBeGreaterThan(0.01)
    expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)))
    expect(rms(phoneDegrade(silence, rate))).toBe(0)
  })
})
