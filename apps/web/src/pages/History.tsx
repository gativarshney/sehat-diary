import { useEffect, useState } from 'react'
import { deleteEntry, listEntries, saveEntry, toCsv, type Entry, type Kind } from '../lib/store'
import Trend from './Trend'

const ICON: Record<Kind, string> = { bp: '❤️', sugar: '🩸', weight: '⚖️', medicine: '💊', other: '📝' }
const LABEL: Record<Kind, string> = { bp: 'बीपी', sugar: 'शुगर', weight: 'वज़न', medicine: 'दवाई', other: 'नोट' }

function valueText(r: Entry): string {
  if (r.kind === 'medicine') return r.note ?? (r.finalValues[0] ? 'ली' : 'नहीं ली')
  if (r.kind === 'bp' && r.finalValues.length >= 2) return `${r.finalValues[0]}/${r.finalValues[1]}`
  return r.finalValues.join(' ')
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'आज'
  if (same(d, y)) return 'कल'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function History({ refreshKey, allowSample = false }: { refreshKey: number; allowSample?: boolean }) {
  const [rows, setRows] = useState<Entry[]>([])

  /** 14 days of clearly synthetic entries (seeded) so trends and history can be shown without real data. */
  async function loadSample() {
    let seed = 7
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const now = Date.now()
    for (let d = 13; d >= 0; d--) {
      const ts = now - d * 24 * 3600 * 1000 - 8 * 3600 * 1000
      const sys = Math.round(122 + rnd() * 14)
      const dia = Math.round(78 + rnd() * 8)
      const sugar = Math.round(118 + rnd() * 30)
      await saveEntry({ id: crypto.randomUUID(), ts, kind: 'bp', heard: `(synthetic) BP ${sys} by ${dia}`, heardValues: [sys, dia], finalValues: [sys, dia], doubt: false, reasons: [], corrected: false, note: 'synthetic' })
      await saveEntry({ id: crypto.randomUUID(), ts: ts + 600000, kind: 'sugar', heard: `(synthetic) sugar fasting ${sugar}`, heardValues: [sugar], finalValues: [sugar], doubt: false, reasons: [], corrected: false, note: 'synthetic' })
      await saveEntry({ id: crypto.randomUUID(), ts: ts + 900000, kind: 'medicine', heard: '(synthetic) subah ki dawai le li', heardValues: [], finalValues: [1], doubt: false, reasons: [], corrected: false, note: 'ली (synthetic)' })
    }
    setRows(await listEntries())
  }

  useEffect(() => {
    listEntries().then(setRows).catch(() => setRows([]))
  }, [refreshKey])

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `sehat-diary-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  async function remove(id: string) {
    await deleteEntry(id)
    setRows((r) => r.filter((x) => x.id !== id))
  }

  const groups: { day: string; items: Entry[] }[] = []
  for (const r of rows) {
    const k = dayKey(r.ts)
    const g = groups[groups.length - 1]
    if (g && g.day === k) g.items.push(r)
    else groups.push({ day: k, items: [r] })
  }

  return (
    <section>
      <div className="card">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>इतिहास</h2>
            <div className="tiny">Doctor ko dikhane ke liye. Koi salah nahi, sirf record.</div>
          </div>
          <div className="row">
            {allowSample && (
              <button className="btn sm ghost" onClick={loadSample} title="adds 14 days of clearly labelled synthetic entries">
                sample data
              </button>
            )}
            <button className="btn sm" onClick={exportCsv} disabled={!rows.length}>
              CSV export
            </button>
          </div>
        </div>
      </div>

      <Trend rows={rows} />

      {!rows.length && (
        <div className="card empty">
          <div className="big">📒</div>
          <div>अभी कोई रिकॉर्ड नहीं। "बोलें" tab se pehli reading boliye.</div>
        </div>
      )}

      {groups.map((g) => (
        <div className="day" key={g.day}>
          <h3>{g.day}</h3>
          {g.items.map((r) => (
            <div className="entry" key={r.id}>
              <div className="ico" aria-hidden="true">
                {ICON[r.kind]}
              </div>
              <div>
                <div className="kind">
                  {LABEL[r.kind]}
                  {r.corrected && <span className="tag" style={{ marginLeft: 8 }}>सुधारा</span>}
                  {r.doubt && !r.corrected && <span className="tag ok" style={{ marginLeft: 8 }}>पक्का किया</span>}
                </div>
                <div className="val">{valueText(r)}</div>
              </div>
              <div className="time">{new Date(r.ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div>
              <button className="del" onClick={() => remove(r.id)} aria-label="delete entry" title="delete">
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
