import { useRef, useState } from 'react'
import { Recorder } from '../lib/recorder'

export interface RecCase {
  id: string
  dev?: string
  roman: string
}

type Take = { url: string; blob: Blob; seconds: number }

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
    const { blob, seconds } = await rec.current.stop()
    rec.current = null
    setActive(null)
    setTakes((t) => ({ ...t, [id]: { url: URL.createObjectURL(blob), blob, seconds } }))
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

  return (
    <main className="wrap">
      <h1>{title}</h1>
      <p className="muted">
        Record each line exactly as written, quiet room, natural pace, 3 to 8 seconds. Files are 16 kHz mono WAV and stay on
        this device until you download them into <code>{folder}</code>. Nothing is uploaded from this page.
      </p>
      <p>
        <strong>
          {done}/{cases.length} recorded
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
