import { describe, expect, it } from 'vitest'
import { scoreCase, summarize } from './run-tier-a'

const bp = { id: 'x', script_roman: '', kind: 'bp' as const, expect: [120, 80], tags: [] }
const sugar = { id: 'y', script_roman: '', kind: 'sugar' as const, expect: [150], tags: [] }
const none = { id: 'z', script_roman: '', kind: 'none' as const, expect: [], tags: [] }

describe('tier-a scoring', () => {
  it('classifies confusion cells', () => {
    expect(scoreCase(bp, 'BP ek sau bees by assi')).toMatchObject({ correct: true, doubtful: false, tn: true })
    expect(scoreCase(bp, 'BP ek sau bees assi')).toMatchObject({ correct: true, doubtful: true, fp: true })
    expect(scoreCase(sugar, 'sugar dedh sau')).toMatchObject({ correct: true, doubtful: true, fp: true })
    expect(scoreCase(sugar, 'sugar ek sau chaalis')).toMatchObject({ correct: false, doubtful: false, fn: true })
    expect(scoreCase(sugar, 'sugar dhai sau')).toMatchObject({ correct: false, doubtful: true, tp: true })
    expect(scoreCase(none, 'aaj mausam accha hai')).toMatchObject({ correct: true })
    expect(scoreCase(none, 'do minute ruko')).toMatchObject({ correct: false })
  })
  it('summarises rates', () => {
    const rows = [
      scoreCase(bp, 'BP ek sau bees by assi'),
      scoreCase(sugar, 'sugar dhai sau'),
      scoreCase(sugar, 'sugar ek sau chaalis'),
      scoreCase(sugar, 'sugar dedh sau'),
    ]
    const s = summarize(rows)
    expect(s.n).toBe(4)
    expect(s.field_accuracy_before_confirmation).toBeCloseTo(0.5)
    expect(s.doubt_precision).toBeCloseTo(0.5)
    expect(s.doubt_recall).toBeCloseTo(0.5)
    expect(s.unnecessary_confirmation_rate).toBeCloseTo(0.25)
    expect(s.silent_error_rate).toBeCloseTo(0.25)
    expect(s.field_accuracy_after_correction).toBeCloseTo(0.75)
  })
})
