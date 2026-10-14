/**
 * Local credit ledger with a hard cap. Every live Gnani call is recorded here.
 *
 * Default rates come from the dashboard headline on 2026-10-14
 * (5,000 credits = ~11,100 STT minutes or ~1,850,000 TTS characters) and are
 * estimates until confirmed by observed balance deltas.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type UnitKind = 'stt_seconds' | 'tts_chars'

export class CreditCapExceeded extends Error {}

export interface Rates {
  perSttSecond: number
  perTtsChar: number
}

export function ratesFromEnv(env: NodeJS.ProcessEnv = process.env): Rates {
  return {
    perSttSecond: Number(env.GNANI_CREDITS_PER_STT_SECOND ?? '0.0075'),
    perTtsChar: Number(env.GNANI_CREDITS_PER_TTS_CHAR ?? '0.0027'),
  }
}

const HEADER = 'ts,purpose,endpoint,units,unit_kind,est_credits,cumulative,note\n'

export class Ledger {
  readonly path: string
  readonly maxCredits: number
  readonly rates: Rates
  cumulative = 0

  constructor(path: string, opts: { maxCredits?: number; rates?: Rates } = {}) {
    this.path = path
    this.maxCredits = opts.maxCredits ?? Number(process.env.GNANI_MAX_CREDITS ?? '2')
    this.rates = opts.rates ?? ratesFromEnv()
    this.cumulative = this.loadCumulative()
  }

  private loadCumulative(): number {
    if (!existsSync(this.path)) return 0
    const lines = readFileSync(this.path, 'utf-8').trim().split('\n').slice(1)
    let total = 0
    for (const line of lines) {
      const cols = line.split(',')
      total += Number(cols[5] ?? 0)
    }
    return total
  }

  estimate(kind: UnitKind, units: number): number {
    return kind === 'stt_seconds' ? units * this.rates.perSttSecond : units * this.rates.perTtsChar
  }

  /** Check the cap before a call. Throws if the estimate would exceed it. */
  reserve(kind: UnitKind, units: number): number {
    const est = this.estimate(kind, units)
    if (this.cumulative + est > this.maxCredits) {
      throw new CreditCapExceeded(
        `estimated ${est.toFixed(4)} credits would push cumulative ${this.cumulative.toFixed(4)} past cap ${this.maxCredits}`,
      )
    }
    return est
  }

  record(purpose: string, endpoint: string, kind: UnitKind, units: number, note = ''): number {
    const est = this.estimate(kind, units)
    this.cumulative += est
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const isNew = !existsSync(this.path)
    const row = [
      new Date().toISOString(),
      purpose,
      endpoint,
      units.toFixed(3),
      kind,
      est.toFixed(5),
      this.cumulative.toFixed(5),
      note.replace(/,/g, ';'),
    ].join(',')
    appendFileSync(this.path, (isNew ? HEADER : '') + row + '\n', 'utf-8')
    return est
  }
}
