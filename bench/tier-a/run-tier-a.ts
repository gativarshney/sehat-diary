/**
 * Tier A benchmark runner (private results).
 *
 * For each case x condition, transcribes the impaired clip once (cached by file hash), runs the
 * parser, and computes: field accuracy before confirmation, doubt precision/recall, unnecessary
 * confirmation rate, and silent-error rate. Results are written to bench/tier-a/results/ (gitignored).
 *
 *   npx tsx bench/tier-a/run-tier-a.ts --speaker S1 [--conditions clean,domestic] [--live] [--max-credits=5]
 *
 * Layout expected: bench/tier-a/audio/<speaker>/<condition>/<id>.wav (made by bench/impair.ts from
 * bench/tier-a/audio/<speaker>/clean/<id>.wav).
 */
import { createHash } from 'node:crypto'
import { config } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseNumbers } from 'hinglish-numbers'
import { GnaniClient } from '../../apps/api/src/gnani'
import { Ledger } from '../../apps/api/src/ledger'

const ROOT = resolve(import.meta.dirname, '..', '..')
config({ path: join(ROOT, '.env') })
const HERE = import.meta.dirname

interface Case {
  id: string
  script_roman: string
  kind: 'bp' | 'sugar' | 'weight' | 'medicine' | 'correction' | 'none'
  expect: number[]
  tags: string[]
}

const args = process.argv.slice(2)
const flag = (name: string, def?: string) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=')[1] : def
}
const live = args.includes('--live')
const speaker = flag('speaker', 'S1')!
const conditions = (flag('conditions', 'clean,domestic,street,narrowband') ?? '').split(',').filter(Boolean)
const maxCredits = Number(flag('max-credits', '5'))

const cases = parseYaml(readFileSync(join(HERE, 'cases.yaml'), 'utf-8')) as Case[]
const resultsDir = join(HERE, 'results')
const cacheDir = join(HERE, 'cache')
for (const d of [resultsDir, cacheDir]) if (!existsSync(d)) mkdirSync(d, { recursive: true })
const ledger = new Ledger(join(resultsDir, 'ledger.csv'), { maxCredits })
const client = new GnaniClient({ mode: live ? 'live' : 'mock', ledger })

async function transcribeCached(path: string, name: string): Promise<{ transcript: string; cached: boolean }> {
  const bytes = readFileSync(path)
  const key = createHash('sha256').update(bytes).digest('hex')
  const cachePath = join(cacheDir, `${key}.json`)
  if (existsSync(cachePath)) return { transcript: JSON.parse(readFileSync(cachePath, 'utf-8')).transcript, cached: true }
  if (!live) return { transcript: `[mock:${name}]`, cached: false }
  const r = await client.transcribe(bytes, name, { purpose: `tier-a:${speaker}` })
  writeFileSync(cachePath, JSON.stringify({ transcript: r.transcript, raw: r.raw, name }, null, 2))
  return { transcript: r.transcript, cached: false }
}

export function scoreCase(c: Case, transcript: string) {
  const r = parseNumbers(transcript)
  const got = r.bp ? [...r.bp] : r.values
  const expect = c.expect
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
  let correct: boolean
  if (c.kind === 'none' || c.kind === 'medicine') correct = eq(got.slice(0, expect.length), expect) && (expect.length > 0 || got.length === 0)
  else if (c.kind === 'bp') correct = eq(got.slice(0, 2), expect)
  else correct = eq(got.slice(0, expect.length), expect)
  const doubtful = r.doubt
  return {
    id: c.id,
    kind: c.kind,
    expect,
    transcript,
    got,
    correct,
    doubtful,
    reasons: r.reasons,
    // confusion cells for the doubt detector
    tp: !correct && doubtful, // wrong and flagged (good)
    fn: !correct && !doubtful, // wrong and silent (bad)
    fp: correct && doubtful, // right but asked (friction)
    tn: correct && !doubtful,
  }
}

export function summarize(rows: ReturnType<typeof scoreCase>[]) {
  const n = rows.length
  const correct = rows.filter((r) => r.correct).length
  const tp = rows.filter((r) => r.tp).length
  const fn = rows.filter((r) => r.fn).length
  const fp = rows.filter((r) => r.fp).length
  const asked = tp + fp
  return {
    n,
    field_accuracy_before_confirmation: n ? correct / n : 0,
    doubt_precision: asked ? tp / asked : null,
    doubt_recall: tp + fn ? tp / (tp + fn) : null,
    unnecessary_confirmation_rate: n ? fp / n : 0,
    silent_error_rate: n ? fn / n : 0,
    // after one perfect correction turn, every flagged error is recovered; silent errors remain
    field_accuracy_after_correction: n ? (correct + tp) / n : 0,
  }
}

async function main() {
  const out: Record<string, unknown> = { speaker, live, conditions: {} }
  for (const cond of conditions) {
    const dir = join(HERE, 'audio', speaker, cond)
    const rows = []
    for (const c of cases) {
      const wav = join(dir, `${c.id}.wav`)
      if (!existsSync(wav)) {
        if (live) console.warn(`missing ${wav}`)
        continue
      }
      const { transcript } = await transcribeCached(wav, `${speaker}-${cond}-${c.id}`)
      rows.push(scoreCase(c, transcript))
    }
    const s = summarize(rows)
    ;(out.conditions as Record<string, unknown>)[cond] = { summary: s, rows }
    console.log(cond, JSON.stringify(s))
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(join(resultsDir, `tier-a_${speaker}_${live ? 'live' : 'mock'}_${stamp}.json`), JSON.stringify(out, null, 2))
  console.log('ledger cumulative est credits:', ledger.cumulative.toFixed(3))
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)
if (isMain) main().catch((e) => {
  console.error(e)
  process.exit(1)
})
