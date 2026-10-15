/**
 * E-min runner. Mock by default; `--live` requires GNANI_MODE=live and a key, and is capped.
 *
 *   npm run emin                 # mock: scores the scripted Devanagari text as the 'transcript'
 *   npm run emin -- --live       # real calls, only after explicit approval
 */
import { config } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseNumbers } from 'hinglish-numbers'
import { GnaniClient } from '../../apps/api/src/gnani'
import { Ledger } from '../../apps/api/src/ledger'
import { CASES, TTS_CHECKS, type Case } from './cases'

const ROOT = resolve(import.meta.dirname, '..', '..')
config({ path: join(ROOT, '.env') })
const HERE = import.meta.dirname
const live = process.argv.includes('--live')
const skipTts = process.argv.includes('--skip-tts')
const maxArg = process.argv.find((a) => a.startsWith('--max-credits='))
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.split('=')[1].split(',').filter(Boolean) : null
const maxCredits = maxArg ? Number(maxArg.split('=')[1]) : 2

type Tier = 'tier1' | 'tier2' | 'unrecoverable'

export function score(c: Case, transcript: string) {
  const r = parseNumbers(transcript)
  const values = r.values
  const expect = c.expect
  let tier: Tier = 'unrecoverable'
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
  if (c.kind === 'none') tier = values.length === 0 ? 'tier1' : 'unrecoverable'
  else if (c.kind === 'correction') tier = r.isCorrection && eq(values.slice(0, 1), expect) ? 'tier1' : eq(values.slice(0, 1), expect) ? 'tier2' : 'unrecoverable'
  else if (c.kind === 'bp') {
    const got = r.bp ? [...r.bp] : values.slice(0, 2)
    if (eq(got, expect) && !r.doubt) tier = 'tier1'
    else if (eq(got, expect) || expect.every((e) => values.includes(e))) tier = 'tier2'
  } else {
    if (eq(values.slice(0, 1), expect) && !r.doubt) tier = 'tier1'
    else if (expect.length && values.includes(expect[0])) tier = 'tier2'
  }
  const silentError = tier === 'unrecoverable' && values.length > 0 && !r.doubt && c.kind !== 'none'
  return { id: c.id, kind: c.kind, expect, transcript, values, bp: r.bp, doubt: r.doubt, reasons: r.reasons, isCorrection: r.isCorrection, tier, silentError }
}

async function main() {
  const audioDir = join(HERE, 'audio')
  const resultsDir = join(HERE, 'results')
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ledger = new Ledger(join(resultsDir, 'ledger.csv'), { maxCredits })
  const mock = Object.fromEntries(CASES.map((c) => [c.id, c.scriptDev]))
  const client = new GnaniClient({ mode: live ? 'live' : 'mock', ledger, mockTranscripts: mock })

  if (live) {
    const missing = (only ? CASES.filter((c) => only.includes(c.id)) : CASES).filter((c) => !existsSync(join(audioDir, `${c.id}.wav`))).map((c) => c.id)
    if (missing.length) {
      console.error('missing recordings:', missing.join(', '))
      process.exit(2)
    }
  }

  const rows = []
  const selected = only ? CASES.filter((c) => only.includes(c.id)) : CASES
  if (only) console.log(`follow-up run for: ${selected.map((c) => c.id).join(', ')} (does not replace the official result)`)
  for (const c of selected) {
    let transcript: string
    let raw: unknown = { mock: true }
    if (live) {
      const r = await client.transcribe(readFileSync(join(audioDir, `${c.id}.wav`)), c.id, { purpose: 'emin' })
      transcript = r.transcript
      raw = r.raw
    } else transcript = mock[c.id]
    const row = { ...score(c, transcript), raw }
    rows.push(row)
    console.log(`${row.id.padEnd(18)} ${row.tier.padEnd(14)} doubt=${String(row.doubt).padEnd(5)} values=${JSON.stringify(row.values)} | ${transcript}`)
  }
  const recoverable = rows.filter((r) => r.tier !== 'unrecoverable').length
  const silent = rows.filter((r) => r.silentError).length
  const decision = only
    ? 'follow-up only (official result unchanged)'
    : recoverable >= 9
      ? 'proceed'
      : recoverable >= 6
        ? 'confirm-all mode'
        : 'fallback: appointment line'
  console.log(`\nrecoverable: ${recoverable}/${rows.length}   tier1: ${rows.filter((r) => r.tier === 'tier1').length}   silent errors: ${silent}`)
  console.log('decision rule ->', decision)

  if (live && !skipTts) {
    for (const v of TTS_CHECKS.voices) {
      const audio = await client.synthesize(TTS_CHECKS.text, { ...v, purpose: 'emin-tts' })
      const out = join(resultsDir, `tts_${v.voice}.wav`)
      writeFileSync(out, audio)
      console.log(`tts ${v.voice}: ${audio.length} bytes -> ${out}`)
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(
    join(resultsDir, `emin_${live ? 'live' : 'mock'}${only ? '_followup' : ''}_${stamp}.json`),
    JSON.stringify({ rows, recoverable, silentErrors: silent, decision, ledgerCumulativeEstCredits: ledger.cumulative }, null, 2),
    'utf-8',
  )
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)
if (isMain) main().catch((e) => {
  console.error(e)
  process.exit(1)
})
