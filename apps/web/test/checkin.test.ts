import { describe, expect, it } from 'vitest'
import { parseNumbers } from 'hinglish-numbers'
import type { ParseResult } from '../src/lib/api'
import { answer, closingText, startCheckIn, type Step } from '../src/lib/checkin'

function parsed(text: string): ParseResult {
  const r = parseNumbers(text)
  return { text, values: r.values, numbers: r.numbers, bp: r.bp, doubt: r.doubt, reasons: r.reasons, is_correction: r.isCorrection }
}

describe('check-in state machine', () => {
  it('runs a confident session without any confirmation', () => {
    let { state, step } = startCheckIn(['medicine', 'bp', 'sugar'], { confirmAll: false })
    expect(step.kind).toBe('ask')
    ;({ state, step } = answer(state, step, 'haan le li', parsed('haan le li')))
    expect(step).toMatchObject({ kind: 'ask', slot: 'bp' })
    ;({ state, step } = answer(state, step, 'ek sau bees by assi', parsed('ek sau bees by assi')))
    expect(step).toMatchObject({ kind: 'ask', slot: 'sugar' })
    ;({ state, step } = answer(state, step, 'sugar ek sau chhabbees', parsed('sugar ek sau chhabbees')))
    expect(step.kind).toBe('done')
    const done = step as Extract<Step, { kind: 'done' }>
    expect(done.answers.map((a) => a.values)).toEqual([[], [120, 80], [126]])
    expect(done.answers[0].taken).toBe(true)
    expect(closingText(done.answers)).toContain('3')
  })

  it('confirms only doubtful values and applies a spoken correction', () => {
    let { state, step } = startCheckIn(['sugar'], { confirmAll: false })
    ;({ state, step } = answer(state, step, 'sugar dedh sau', parsed('sugar dedh sau')))
    expect(step).toMatchObject({ kind: 'confirm', slot: 'sugar' })
    expect((step as Extract<Step, { kind: 'confirm' }>).text).toContain('150')
    ;({ state, step } = answer(state, step, 'nahi, ek sau pachpan', parsed('nahi, ek sau pachpan')))
    expect(step.kind).toBe('say')
    expect(state.answers[0]).toMatchObject({ values: [155], corrected: true, doubt: false })
  })

  it('accepts a bare yes on a doubtful value', () => {
    let { state, step } = startCheckIn(['bp'], { confirmAll: false })
    ;({ state, step } = answer(state, step, 'ek sau chauvan chauranve', parsed('ek sau chauvan chauranve')))
    expect(step.kind).toBe('confirm')
    ;({ state, step } = answer(state, step, 'haan', parsed('haan')))
    expect(step.kind).toBe('done')
    expect(state.answers[0]).toMatchObject({ values: [154, 94], corrected: false, doubt: false })
  })

  it('corrects only the systolic value when one number is given for bp', () => {
    let { state, step } = startCheckIn(['bp'], { confirmAll: false })
    ;({ state, step } = answer(state, step, 'ek sau chauvan chauranve', parsed('ek sau chauvan chauranve')))
    ;({ state, step } = answer(state, step, 'nahi ek sau pachas', parsed('nahi ek sau pachas')))
    expect(state.answers[0].values).toEqual([150, 94])
  })

  it('re-asks on "no" and skips after repeated misunderstandings', () => {
    let { state, step } = startCheckIn(['sugar'], { confirmAll: false })
    ;({ state, step } = answer(state, step, 'pata nahi', parsed('pata nahi')))
    expect(step.kind).toBe('done')
    expect(state.answers[0].skipped).toBe(true)

    ;({ state, step } = startCheckIn(['weight'], { confirmAll: false }))
    ;({ state, step } = answer(state, step, 'hmm', parsed('hmm')))
    expect(step).toMatchObject({ kind: 'ask', slot: 'weight' })
    ;({ state, step } = answer(state, step, 'kya', parsed('kya')))
    ;({ state, step } = answer(state, step, 'haan', parsed('haan')))
    expect(step.kind).toBe('done')
    expect(state.answers[0].skipped).toBe(true)
  })

  it('confirm-all mode asks even for a confident value', () => {
    let { state, step } = startCheckIn(['bp'], { confirmAll: true })
    ;({ state, step } = answer(state, step, 'ek sau bees by assi', parsed('ek sau bees by assi')))
    expect(step.kind).toBe('confirm')
    ;({ state, step } = answer(state, step, 'haan', parsed('haan')))
    expect(step.kind).toBe('done')
    expect(state.answers[0].values).toEqual([120, 80])
  })

  it('a different reading spoken during a confirmation does not overwrite the pending value', () => {
    let { state, step } = startCheckIn(['bp', 'sugar'], { confirmAll: true })
    ;({ state, step } = answer(state, step, 'ek sau atthais by bayasi', parsed('ek sau atthais by bayasi')))
    expect(step.kind).toBe('confirm')
    ;({ state, step } = answer(state, step, 'sugar dedh sau', parsed('sugar dedh sau')))
    expect(step.kind).toBe('confirm')
    expect(state.pending?.values).toEqual([128, 82])
    ;({ state, step } = answer(state, step, 'haan', parsed('haan')))
    expect(state.answers[0].values).toEqual([128, 82])
    expect(step).toMatchObject({ kind: 'ask', slot: 'sugar' })
  })

  it('records medicine not taken', () => {
    let { state, step } = startCheckIn(['medicine'], { confirmAll: false })
    ;({ state, step } = answer(state, step, 'nahi li', parsed('nahi li')))
    expect(step.kind).toBe('done')
    expect(state.answers[0].taken).toBe(false)
  })
})
