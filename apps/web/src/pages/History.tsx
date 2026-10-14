import { useEffect, useState } from 'react'
import { deleteEntry, listEntries, toCsv, type Entry } from '../lib/store'
import Trend from './Trend'

export default function History({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Entry[]>([])

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
        <button onClick={exportCsv} disabled={!rows.length}>
          CSV
        </button>
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
