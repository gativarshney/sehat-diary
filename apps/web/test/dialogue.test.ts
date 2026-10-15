import { describe, expect, it } from 'vitest'
import { parseNumbers } from 'hinglish-numbers'
import type { ParseResult } from '../src/lib/api'
import { guessKind, interpretConfirmation, readbackText } from '../src/lib/dialogue'
import { encodeWav, floatTo16, resample } from '../src/lib/wav'

function parsed(text: string): ParseResult {
  const r = parseNumbers(text)
  return { text, values: r.values, numbers: r.numbers, bp: r.bp, doubt: r.doubt, reasons: r.reasons, is_correction: r.isCorrection }
}

describe('guessKind', () => {
  it('maps keywords and bp structure', () => {
    expect(guessKind('BP ek sau bees by assi', parsed('BP ek sau bees by assi'))).toBe('bp')
    expect(guessKind('शुगर सवा सौ', parsed('शुगर सवा सौ'))).toBe('sugar')
    expect(guessKind('vajan bahattar', parsed('vajan bahattar'))).toBe('weight')
    expect(guessKind('दवाई ले ली', parsed('दवाई ले ली'))).toBe('medicine')
    expect(guessKind('aaj mausam accha hai', parsed('aaj mausam accha hai'))).toBe('other')
  })
})

describe('readbackText', () => {
  it('asks only when doubtful', () => {
    const confident = readbackText('bp', parsed('BP ek sau bees by assi'), false)
    expect(confident.asksConfirm).toBe(false)
    expect(confident.text).toContain('120')
    const doubtful = readbackText('sugar', parsed('sugar dedh sau'), false)
    expect(doubtful.asksConfirm).toBe(true)
    expect(doubtful.text).toContain('150')
    expect(doubtful.text).toContain('सही है')
  })
  it('handles no number', () => {
    expect(readbackText('other', parsed('aaj mausam'), false).asksConfirm).toBe(false)
    expect(readbackText('bp', parsed('BP ek sau bees by assi'), true).asksConfirm).toBe(true)
  })
})

describe('interpretConfirmation', () => {
  it('yes, no, correction, unclear', () => {
    expect(interpretConfirmation('haan', parsed('haan'))).toEqual({ type: 'yes' })
    expect(interpretConfirmation('नहीं', parsed('नहीं'))).toEqual({ type: 'no' })
    expect(interpretConfirmation('nahi atthais', parsed('nahi atthais'))).toEqual({ type: 'correct', values: [28] })
    expect(interpretConfirmation('ek sau atthais', parsed('ek sau atthais'))).toEqual({ type: 'correct', values: [128] })
    expect(interpretConfirmation('hmm', parsed('hmm'))).toEqual({ type: 'unclear' })
  })
})

describe('wav utilities', () => {
  it('encodes a valid header and resamples', () => {
    const blob = encodeWav(new Int16Array(16000), 16000)
    expect(blob.size).toBe(44 + 32000)
    const down = resample(new Float32Array(48000), 48000, 16000)
    expect(down.length).toBe(16000)
    const i16 = floatTo16(new Float32Array([1, -1, 0]))
    expect(Array.from(i16)).toEqual([32767, -32768, 0])
  })
})

describe('analyzeDropouts', () => {
  it('flags exact-zero gaps inside speech and accepts clean speech', async () => {
    const { analyzeDropouts } = await import('../src/lib/wav')
    const rate = 16000
    const s = new Int16Array(rate * 3)
    // 2 s of "speech": noisy tone from 0.5 s to 2.5 s
    for (let i = rate * 0.5; i < rate * 2.5; i++) s[i] = Math.round(4000 * Math.sin(i / 7) + ((i * 7919) % 97) - 48)
    expect(analyzeDropouts(s, rate).ok).toBe(true)
    // punch a 200 ms hole of exact zeros in the middle
    for (let i = rate * 1.4; i < rate * 1.6; i++) s[i] = 0
    const r = analyzeDropouts(s, rate)
    expect(r.ok).toBe(false)
    expect(r.zeroWindows).toBeGreaterThanOrEqual(9)
    expect(r.longestGapMs).toBeGreaterThanOrEqual(180)
  })
})
