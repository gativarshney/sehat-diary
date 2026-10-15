import { useEffect, useState } from 'react'
import { deleteEntry, listEntries, saveEntry, toCsv, type Entry } from '../lib/store'
import Trend from './Trend'

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
      await saveEntry({ id: crypto.randomUUID(), ts: ts + 900000, kind: 'medicine', heard: '(synthetic) subah ki dawai le li', heardValues: [], finalValues: [1], doubt: false, reasons: [], corrected: false, note: 'li (synthetic)' })
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

  return (
    <section className="history">
      <div className="row between">
        <h2>इतिहास (history)</h2>
        <span>
          {allowSample && (
            <button onClick={loadSample} title="adds 14 days of clearly labelled synthetic entries">
              Load sample history
            </button>
          )}{' '}
          <button onClick={exportCsv} disabled={!rows.length}>
            CSV
          </button>
        </span>
      </div>
      <Trend rows={rows} />
      {!rows.length && <p className="muted">अभी कोई रिकॉर्ड नहीं।</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span className="muted">{new Date(r.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>{' '}
            <strong>{r.kind}</strong>{' '}
            {r.kind === 'medicine'
              ? r.note ?? (r.finalValues[0] ? 'li' : 'nahi li')
              : r.kind === 'bp' && r.finalValues.length >= 2
                ? `${r.finalValues[0]}/${r.finalValues[1]}`
                : r.finalValues.join(' ')}
            {r.corrected && <span className="tag">corrected</span>}
            {r.doubt && !r.corrected && <span className="tag">confirmed</span>}
            <button className="link" onClick={() => remove(r.id)} aria-label="delete">
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">कोई सलाह नहीं। सिर्फ़ रिकॉर्ड। डॉक्टर को दिखाएँ।</p>
    </section>
  )
}
