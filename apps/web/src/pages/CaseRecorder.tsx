import { useRef, useState } from 'react'
import { Recorder } from '../lib/recorder'
import type { DropoutReport } from '../lib/wav'

export interface RecCase {
  id: string
  dev?: string
  roman: string
}

type Take = { url: string; blob: Blob; seconds: number; report: DropoutReport }

/** Records a list of scripted utterances as 16 kHz mono WAV files for download. Nothing is uploaded. */
export default function CaseRecorder({ title, cases, folder }: { title: string; cases: RecCase[]; folder: string }) {
  const [takes, setTakes] = useState<Record<string, Take>>({})
  const [active, setActive] = useState<string | null>(null)
  const rec = useRef<Recorder | null>(null)

  async function start(id: string) {
    rec.current = new Recorder()
    await rec.current.start()
    setActive(id)
  }

  async function stop(id: string) {
    if (!rec.current) return
    const { blob, seconds, report } = await rec.current.stop()
    rec.current = null
    setActive(null)
    setTakes((t) => ({ ...t, [id]: { url: URL.createObjectURL(blob), blob, seconds, report } }))
  }

  function download(id: string) {
    const t = takes[id]
    if (!t) return
    const a = document.createElement('a')
    a.href = t.url
    a.download = `${id}.wav`
    a.click()
  }

  function downloadAll() {
    for (const c of cases) if (takes[c.id]) download(c.id)
  }

  const done = cases.filter((c) => takes[c.id]).length
  const good = cases.filter((c) => takes[c.id]?.report.ok).length

  return (
    <main className="wrap">
      <h1>{title}</h1>
      <p className="muted">
        Record each line exactly as written, quiet room, natural pace, 3 to 8 seconds. Files are 16 kHz mono WAV and stay on
        this device until you download them into <code>{folder}</code>. Nothing is uploaded from this page. Each take is
        checked for dropouts and clipping; re-record anything not marked "quality ok". If Chrome blocks multiple downloads,
        click the blocked-download icon in the address bar and choose "Always allow", or use the per-line Download buttons.
      </p>
      <p>
        <strong>
          {done}/{cases.length} recorded, {good} good
        </strong>{' '}
        <button onClick={downloadAll} disabled={done === 0}>
          Download all recorded
        </button>{' '}
        <a href="#/">Back</a>
      </p>
      <ol className="cases">
        {cases.map((c) => {
          const t = takes[c.id]
          const isActive = active === c.id
          return (
            <li key={c.id} className={t ? 'done' : ''}>
              <div className="case-text">
                {c.dev && <div className="dev">{c.dev}</div>}
                <div className={c.dev ? 'roman muted' : 'dev'}>{c.roman}</div>
                <div className="id muted">{c.id}</div>
              </div>
              <div className="case-actions">
                {!isActive ? (
                  <button onClick={() => start(c.id)} disabled={active !== null}>
                    {t ? 'Re-record' : 'Record'}
                  </button>
                ) : (
                  <button className="danger" onClick={() => stop(c.id)}>
                    Stop
                  </button>
                )}
                {t && (
                  <>
                    <audio controls src={t.url} />
                    <span className="muted">{t.seconds.toFixed(1)} s</span>
                    {t.report.ok ? <span className="tag ok">quality ok</span> : <span className="tag bad">{t.report.reason}</span>}
                    <button onClick={() => download(c.id)}>Download</button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </main>
  )
}
