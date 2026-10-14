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
    const confident = readbackText('bp', parsed('BP ek sau bees by assi'))
    expect(confident.asksConfirm).toBe(false)
    expect(confident.text).toContain('120')
    const doubtful = readbackText('sugar', parsed('sugar dedh sau'))
    expect(doubtful.asksConfirm).toBe(true)
    expect(doubtful.text).toContain('150')
    expect(doubtful.text).toContain('सही है')
  })
  it('handles no number', () => {
    expect(readbackText('other', parsed('aaj mausam')).asksConfirm).toBe(false)
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
