import type { ParseResult } from './api'
import type { Kind } from './store'

/** Guess the reading type from the transcript. Keyword rules only. */
export function guessKind(text: string, p: ParseResult): Kind {
  const t = text.toLowerCase()
  if (p.bp || /bp|बीपी|blood|प्रेशर|pressure/.test(t)) return 'bp'
  if (/sugar|शुगर|glucose|ग्लूकोज|fasting|फास्टिंग/.test(t)) return 'sugar'
  if (/weight|वेट|वज़न|वजन|kilo|किलो|kg/.test(t)) return 'weight'
  if (/dawai|दवाई|dawa|दवा|goli|गोली|tablet|टैबलेट/.test(t)) return 'medicine'
  return 'other'
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v)
}

/**
 * Build the Hindi read-back sentence. Timbre's text normalisation reads digits in Hindi,
 * so numerals are sent as digits. Only doubtful readings get a question; confident ones get
 * a short confirmation statement instead (no question, no extra turn).
 */
export function readbackText(kind: Kind, p: ParseResult): { text: string; asksConfirm: boolean } {
  const v = p.values
  let core = ''
  if (kind === 'bp' && (p.bp || v.length >= 2)) {
    const [a, b] = p.bp ?? [v[0], v[1]]
    core = `बीपी ${fmt(a)} बाय ${fmt(b)}`
  } else if (kind === 'sugar' && v.length) core = `शुगर ${fmt(v[0])}`
  else if (kind === 'weight' && v.length) core = `वज़न ${fmt(v[0])} किलो`
  else if (kind === 'medicine') core = 'दवाई ले ली'
  else if (v.length) core = `${fmt(v[0])}`
  else return { text: 'मुझे कोई नंबर नहीं मिला। कृपया दोबारा बोलें।', asksConfirm: false }

  if (p.doubt) return { text: `${core}, सही है?`, asksConfirm: true }
  return { text: `ठीक है, ${core} नोट कर लिया।`, asksConfirm: false }
}

/** Interpret a spoken confirmation turn. */
export type Confirmation = { type: 'yes' } | { type: 'no' } | { type: 'correct'; values: number[] } | { type: 'unclear' }

export function interpretConfirmation(text: string, p: ParseResult): Confirmation {
  const t = text.toLowerCase().trim()
  const yes = /^(haan|han|ha|haa|हाँ|हां|yes|sahi|सही|theek|ठीक)\b/.test(t)
  if (p.values.length) return { type: 'correct', values: p.values }
  if (yes) return { type: 'yes' }
  if (p.is_correction || /^(nahi|nahin|नहीं|नही|no|galat|गलत)\b/.test(t)) return { type: 'no' }
  return { type: 'unclear' }
}
