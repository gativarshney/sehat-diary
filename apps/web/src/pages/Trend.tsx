import { useMemo } from 'react'
import type { Entry } from '../lib/store'

/** Plain 14-day trend lines per reading kind. No thresholds, no colours by value, no interpretation. */
export default function Trend({ rows }: { rows: Entry[] }) {
  // the newest entry anchors the window, so rendering stays pure
  const newest = rows.reduce((m, r) => Math.max(m, r.ts), 0)
  const since = useMemo(() => newest - 14 * 24 * 3600 * 1000, [newest])
  const recent = rows.filter((r) => r.ts >= since)
  const series: { label: string; unit: string; points: { ts: number; v: number }[] }[] = [
    { label: 'बीपी ऊपर', unit: 'mmHg', points: recent.filter((r) => r.kind === 'bp' && r.finalValues.length >= 2).map((r) => ({ ts: r.ts, v: r.finalValues[0] })) },
    { label: 'बीपी नीचे', unit: 'mmHg', points: recent.filter((r) => r.kind === 'bp' && r.finalValues.length >= 2).map((r) => ({ ts: r.ts, v: r.finalValues[1] })) },
    { label: 'शुगर', unit: 'mg/dL', points: recent.filter((r) => r.kind === 'sugar' && r.finalValues.length).map((r) => ({ ts: r.ts, v: r.finalValues[0] })) },
    { label: 'वज़न', unit: 'kg', points: recent.filter((r) => r.kind === 'weight' && r.finalValues.length).map((r) => ({ ts: r.ts, v: r.finalValues[0] })) },
  ].filter((s) => s.points.length >= 2)
  if (!series.length) return null
  return (
    <div className="card">
      <h2>पिछले 14 दिन</h2>
      <div className="sparks">
        {series.map((s) => (
          <Spark key={s.label} label={s.label} unit={s.unit} points={s.points} />
        ))}
      </div>
    </div>
  )
}

function Spark({ label, unit, points }: { label: string; unit: string; points: { ts: number; v: number }[] }) {
  const w = 240
  const h = 56
  const sorted = [...points].sort((a, b) => a.ts - b.ts)
  const xs = sorted.map((p) => p.ts)
  const ys = sorted.map((p) => p.v)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const sx = (t: number) => (x1 === x0 ? w / 2 : ((t - x0) / (x1 - x0)) * (w - 8) + 4)
  const sy = (v: number) => (y1 === y0 ? h / 2 : h - 4 - ((v - y0) / (y1 - y0)) * (h - 8))
  const d = sorted.map((p, i) => `${i ? 'L' : 'M'}${sx(p.ts).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ')
  const last = sorted[sorted.length - 1]
  return (
    <div className="spark">
      <div className="label">{label}</div>
      <div className="range">
        {last.v} <span className="tiny">{unit} · {y0} se {y1}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label={`${label} trend`}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={sx(last.ts)} cy={sy(last.v)} r="4" fill="currentColor" />
      </svg>
    </div>
  )
}
