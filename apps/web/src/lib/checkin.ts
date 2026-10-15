/**
 * Half-duplex daily check-in dialogue as a pure state machine.
 *
 * The app asks one question at a time, listens, parses, and either files the answer or reads
 * back a doubtful value for confirmation. No LLM; every transition is explicit and testable.
 * Audio and network are injected by the caller (see Capture/CheckIn pages); this module only
 * decides what to say next and what to store.
 */
import type { ParseResult } from './api'
import { confirmAllEnabled, interpretConfirmation } from './dialogue'

export type Slot = 'medicine' | 'bp' | 'sugar' | 'weight'

export interface SlotAnswer {
  slot: Slot
  values: number[] // [] for medicine means "taken"; medicine uses taken flag below
  taken?: boolean
  heard: string
  doubt: boolean
  reasons: string[]
  corrected: boolean
  skipped: boolean
}

export type Step =
  | { kind: 'say'; text: string }
  | { kind: 'ask'; slot: Slot; text: string }
  | { kind: 'confirm'; slot: Slot; text: string; pending: SlotAnswer }
  | { kind: 'done'; answers: SlotAnswer[] }

export interface CheckInState {
  slots: Slot[]
  index: number
  answers: SlotAnswer[]
  pending: SlotAnswer | null
  retries: number
  /** confirm every value regardless of doubt (E-min decision rule until Tier A validates the detector) */
  confirmAll: boolean
}

const PROMPTS: Record<Slot, string> = {
  medicine: 'आज सुबह की दवाई ली?',
  bp: 'बीपी कितना था?',
  sugar: 'शुगर कितनी थी?',
  weight: 'वज़न कितना है?',
}

const MAX_RETRIES = 2

export function startCheckIn(slots: Slot[] = ['medicine', 'bp', 'sugar'], opts: { confirmAll?: boolean } = {}): { state: CheckInState; step: Step } {
  const state: CheckInState = { slots, index: 0, answers: [], pending: null, retries: 0, confirmAll: opts.confirmAll ?? confirmAllEnabled() }
  return { state, step: { kind: 'ask', slot: slots[0], text: `नमस्ते। ${PROMPTS[slots[0]]}` } }
}

function fmt(v: number): string {
  return String(v)
}

function readback(slot: Slot, values: number[]): string {
  if (slot === 'bp' && values.length >= 2) return `बीपी ${fmt(values[0])} बाय ${fmt(values[1])}, सही है?`
  if (slot === 'sugar' && values.length) return `शुगर ${fmt(values[0])}, सही है?`
  if (slot === 'weight' && values.length) return `वज़न ${fmt(values[0])} किलो, सही है?`
  return 'सही है?'
}

function nextAsk(state: CheckInState): Step {
  if (state.index >= state.slots.length) return { kind: 'done', answers: state.answers }
  const slot = state.slots[state.index]
  return { kind: 'ask', slot, text: PROMPTS[slot] }
}

function isYes(text: string): boolean {
  return /^(haan|han|ha|haa|हाँ|हां|yes|le li|ली|li|ले ली|theek|ठीक)\b/.test(text.toLowerCase().trim()) || /ले ली|le li|li hai|खा ली|kha li/.test(text.toLowerCase())
}
function isNo(text: string): boolean {
  return /^(nahi|nahin|नहीं|नही|no|abhi nahi|अभी नहीं)\b/.test(text.toLowerCase().trim()) || /नहीं ली|nahi li|nahi khayi/.test(text.toLowerCase())
}
function isSkip(text: string): boolean {
  return /skip|chhodo|छोड़ो|pata nahi|पता नहीं|baad mein|बाद में/.test(text.toLowerCase())
}

/**
 * Feed the user's answer (transcript + parse) for the current step and get the next step.
 * The caller is responsible for speaking `step.text` and then listening again.
 */
export function answer(state: CheckInState, step: Step, heard: string, parsed: ParseResult): { state: CheckInState; step: Step } {
  if (step.kind === 'done' || step.kind === 'say') return { state, step: nextAsk(state) }

  if (step.kind === 'confirm') {
    const c = interpretConfirmation(heard, parsed)
    const pending = step.pending
    if (c.type === 'yes') {
      const s = { ...state, answers: [...state.answers, { ...pending, doubt: false }], pending: null, index: state.index + 1, retries: 0 }
      return { state: s, step: nextAsk(s) }
    }
    if (c.type === 'correct') {
      let values = c.values
      if (pending.slot === 'bp') values = c.values.length >= 2 ? [c.values[0], c.values[1]] : [c.values[0], pending.values[1]]
      else values = [c.values[0]]
      const fixed: SlotAnswer = { ...pending, values, corrected: true, doubt: false }
      const s = { ...state, answers: [...state.answers, fixed], pending: null, index: state.index + 1, retries: 0 }
      return { state: s, step: { kind: 'say', text: `ठीक है, ${readback(pending.slot, values).replace(', सही है?', '')} नोट कर लिया।` } }
    }
    if (c.type === 'no') {
      return { state: { ...state, retries: state.retries + 1 }, step: { kind: 'ask', slot: pending.slot, text: `ठीक है, ${PROMPTS[pending.slot]} दोबारा बोलिए।` } }
    }
    if (state.retries >= MAX_RETRIES) return skip(state, pending.slot, heard)
    return { state: { ...state, retries: state.retries + 1 }, step: { kind: 'confirm', slot: pending.slot, text: readback(pending.slot, pending.values), pending } }
  }

  // step.kind === 'ask'
  const slot = step.slot
  if (isSkip(heard)) return skip(state, slot, heard)

  if (slot === 'medicine') {
    if (isYes(heard) || isNo(heard)) {
      const taken = isYes(heard) && !isNo(heard)
      const a: SlotAnswer = { slot, values: [], taken, heard, doubt: false, reasons: [], corrected: false, skipped: false }
      const s = { ...state, answers: [...state.answers, a], index: state.index + 1, retries: 0 }
      return { state: s, step: nextAsk(s) }
    }
    return retryOrSkip(state, slot, heard, PROMPTS.medicine)
  }

  const values = parsed.bp ? [...parsed.bp] : parsed.values
  const enough = slot === 'bp' ? values.length >= 2 : values.length >= 1
  if (!enough) return retryOrSkip(state, slot, heard, PROMPTS[slot])

  const a: SlotAnswer = { slot, values: slot === 'bp' ? values.slice(0, 2) : values.slice(0, 1), heard, doubt: parsed.doubt, reasons: parsed.reasons, corrected: false, skipped: false }
  if (parsed.doubt || state.confirmAll) {
    return { state: { ...state, pending: a, retries: 0 }, step: { kind: 'confirm', slot, text: readback(slot, a.values), pending: a } }
  }
  const s = { ...state, answers: [...state.answers, a], index: state.index + 1, retries: 0 }
  return { state: s, step: nextAsk(s) }
}

function retryOrSkip(state: CheckInState, slot: Slot, heard: string, prompt: string): { state: CheckInState; step: Step } {
  if (state.retries >= MAX_RETRIES) return skip(state, slot, heard)
  return { state: { ...state, retries: state.retries + 1 }, step: { kind: 'ask', slot, text: `मुझे समझ नहीं आया। ${prompt}` } }
}

function skip(state: CheckInState, slot: Slot, heard: string): { state: CheckInState; step: Step } {
  const a: SlotAnswer = { slot, values: [], heard, doubt: false, reasons: ['skipped'], corrected: false, skipped: true }
  const s = { ...state, answers: [...state.answers, a], pending: null, index: state.index + 1, retries: 0 }
  return { state: s, step: nextAsk(s) }
}

export function closingText(answers: SlotAnswer[]): string {
  const n = answers.filter((a) => !a.skipped).length
  return n ? `धन्यवाद। आज ${n} रिकॉर्ड नोट हो गए।` : 'ठीक है, बाद में बात करते हैं।'
}
