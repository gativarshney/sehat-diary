import { describe, expect, it } from 'vitest'
import { parseNumbers } from '../src'

const cases: [string, number[]][] = [
  ['बीपी एक सौ अट्ठाईस बाय बयासी', [128, 82]],
  ['BP ek sau atthais by bayasi', [128, 82]],
  ['ब्लड प्रेशर एक सौ बीस बटा अस्सी', [120, 80]],
  ['ऊपर एक सौ तीस नीचे पचासी', [130, 85]],
  ['बीपी 128/82', [128, 82]],
  ['BP १२८ बाय ८२', [128, 82]],
  ['शुगर फास्टिंग डेढ़ सौ', [150]],
  ['sugar fasting dedh sau', [150]],
  ['खाने के बाद शुगर ढाई सौ', [250]],
  ['शुगर सवा सौ था', [125]],
  ['शुगर पौने दो सौ', [175]],
  ['sugar paune do sau', [175]],
  ['वेट चौवन पॉइंट पाँच किलो', [54.5]],
  ['weight 54.5 kilo', [54.5]],
  ['वज़न बहत्तर दशमलव दो', [72.2]],
  ['sugar 1,40 nahi 140', [140, 140]],
  ['दवाई ले ली', []],
  ['आज मौसम बहुत अच्छा है', []],
  ['sugar ek sau chhabbees', [126]],
  ['do hazaar paanch', [2005]],
  ['sawa do sau', [225]],
  // forms observed in the live E-min transcripts (Prisma ITN keeps fraction words, converts the rest)
  ['शुगर फास्टिंग डेढ़ 100', [150]],
  ['शुगर सवा 100 था', [125]],
  ['पौने 200', [175]],
  ['ढाई 100', [250]],
  ['सवा 200', [225]],
  ['डेढ़ 1000', [1500]],
  ['ब्लड प्रेशर 120 बटासी', [120, 80]],
  ['बीपी 154 94', [154, 94]],
  ['अरे नहीं 128', [128]],
  ['aadha kilo', [0.5]],
]

describe('parseNumbers values', () => {
  for (const [text, expected] of cases) {
    it(text, () => {
      expect(parseNumbers(text).values).toEqual(expected)
    })
  }
})

describe('blood pressure and doubt', () => {
  it('bare pair is doubtful', () => {
    const r = parseNumbers('बीपी एक सौ चौवन चौरानवे')
    expect(r.bp).toEqual([154, 94])
    expect(r.doubt).toBe(true)
    expect(r.reasons).toContain('bare pair without separator')
  })
  it('separator pair is confident', () => {
    const r = parseNumbers('BP ek sau atthais by bayasi')
    expect(r.bp).toEqual([128, 82])
    expect(r.doubt).toBe(false)
  })
  it('fraction word sets doubt', () => {
    const r = parseNumbers('sugar fasting dedh sau')
    expect(r.doubt).toBe(true)
    expect(r.reasons).toContain('fraction word')
  })
  it('spoken decimal sets doubt', () => {
    expect(parseNumbers('वज़न बहत्तर दशमलव दो').reasons).toContain('spoken decimal')
  })
})

describe('corrections', () => {
  it('detects a leading nahi', () => {
    const r = parseNumbers('नहीं, एक सौ अट्ठाईस')
    expect(r.isCorrection).toBe(true)
    expect(r.values).toEqual([128])
    const r2 = parseNumbers('nahi atthais')
    expect(r2.isCorrection).toBe(true)
    expect(r2.values).toEqual([28])
  })
  it('a bp utterance with one number is doubtful', () => {
    const r = parseNumbers('ब्लड प्रेशर 120')
    expect(r.values).toEqual([120])
    expect(r.doubt).toBe(true)
  })
  it('a plain reading is not a correction', () => {
    expect(parseNumbers('sugar dedh sau').isCorrection).toBe(false)
  })
})
