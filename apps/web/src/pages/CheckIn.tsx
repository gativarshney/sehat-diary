import { useRef, useState } from 'react'
import { parse, stt, tts } from '../lib/api'
import { answer, closingText, startCheckIn, type CheckInState, type Step } from '../lib/checkin'
import { Recorder } from '../lib/recorder'
import { saveEntry, type Entry } from '../lib/store'

type UiPhase = 'idle' | 'speaking' | 'listening' | 'processing' | 'done'

interface Turn {
  who: 'app' | 'user'
  text: string
  note?: string
}

/** Scripted answers used when the API is in mock mode (no microphone, no credits). */
const MOCK_SCRIPT = ['haan le li', 'ek sau atthais by bayasi', 'haan', 'sugar dedh sau', 'nahi, ek sau pachpan']
const SLOTS = ['medicine', 'bp', 'sugar'] as const

/**
 * Proactive half-duplex check-in: the app asks, then listens; it reads back doubtful values
 * (or every value in confirm-all mode). Audio in/out is injected here; dialogue decisions live in lib/checkin.ts.
 */
export default function CheckIn({ apiMode, onSaved }: { apiMode: string; onSaved: () => void }) {
  const [phase, setPhase] = useState<UiPhase>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const rec = useRef<Recorder | null>(null)
  const stopResolver = useRef<(() => void) | null>(null)
  const isMock = apiMode !== 'live'
  const ready = apiMode === 'live' || apiMode === 'mock'
  const mockIdx = useRef(0)

  async function speak(text: string) {
    setTurns((t) => [...t, { who: 'app', text }])
    setPhase('speaking')
    try {
      const { url } = await tts(text)
      if (audio.current) {
        audio.current.src = url
        await audio.current.play()
        await new Promise<void>((res) => {
          audio.current!.onended = () => res()
          audio.current!.onerror = () => res()
        })
      }
    } catch {
      /* mock bytes or autoplay blocked: continue */
    }
  }

  async function listenOnce(): Promise<string> {
    if (isMock) {
      const t = MOCK_SCRIPT[mockIdx.current++ % MOCK_SCRIPT.length]
      setPhase('processing')
      const s = await stt(silentWav(), t)
      return s.transcript
    }
    rec.current = new Recorder()
    await rec.current.start()
    setPhase('listening')
    await new Promise<void>((res) => (stopResolver.current = res))
    const { blob } = await rec.current.stop()
    rec.current = null
    setPhase('processing')
    const s = await stt(blob)
    return s.transcript
  }

  function stopListening() {
    stopResolver.current?.()
    stopResolver.current = null
  }

  async function run() {
    setErr(null)
    setTurns([])
    setProgress(0)
    mockIdx.current = 0
    try {
      let { state, step } = startCheckIn([...SLOTS])
      while (step.kind !== 'done') {
        await speak(step.text)
        if (step.kind === 'say') {
          ;({ state, step } = answer(state, step, '', emptyParse()))
          setProgress(state.index)
          continue
        }
        const heard = await listenOnce()
        const p = await parse(heard)
        const prev: Step = step
        ;({ state, step } = answer(state, prev, heard, { ...p }))
        setProgress(state.index)
        const last = state.answers[state.answers.length - 1]
        const note = prev.kind === 'confirm' ? (last?.corrected ? 'सुधारा' : 'पक्का') : p.doubt ? `shak: ${p.reasons.join(', ')}` : undefined
        setTurns((t) => [...t, { who: 'user', text: heard, note }])
      }
      await persist(state)
      await speak(closingText(state.answers))
      setPhase('done')
      onSaved()
    } catch (e) {
      setErr(String(e))
      setPhase('idle')
    }
  }

  async function persist(state: CheckInState) {
    for (const a of state.answers) {
      if (a.skipped) continue
      const e: Entry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: a.slot === 'medicine' ? 'medicine' : a.slot,
        heard: a.heard,
        heardValues: a.values,
        finalValues: a.slot === 'medicine' ? (a.taken ? [1] : [0]) : a.values,
        doubt: a.reasons.length > 0,
        reasons: a.reasons,
        corrected: a.corrected,
        note: a.slot === 'medicine' ? (a.taken ? 'li' : 'nahi li') : undefined,
      }
      await saveEntry(e)
    }
  }

  return (
    <section>
      <audio ref={audio} hidden />
      <div className="card hero">
        <h1>रोज़ का चेक-इन</h1>
        <p>App teen sawaal poochega: dawai, BP, sugar. Aap bas jawab boliye. Shak ho to woh number dohra kar poochega.</p>
        <div className="mic-wrap">
          {phase === 'idle' || phase === 'done' ? (
            <button className="btn primary" onClick={run} disabled={!ready} style={{ padding: '14px 28px', fontSize: '1.05rem' }}>
              {isMock ? 'Sample check-in chalayein' : 'चेक-इन शुरू करें'}
            </button>
          ) : phase === 'listening' ? (
            <button className="mic listening" onClick={stopListening} aria-label="stop listening">
              ■
            </button>
          ) : (
            <button className="mic busy" disabled>
              {phase === 'speaking' ? '🔊' : '…'}
            </button>
          )}
          <div className={`mic-label ${phase === 'processing' ? 'dots' : ''}`}>
            {phase === 'listening' ? 'सुन रहा हूँ… बोलकर रोकें' : phase === 'speaking' ? 'बोल रहा हूँ' : phase === 'processing' ? 'समझ रहा हूँ' : phase === 'done' ? 'हो गया' : ''}
          </div>
          {(turns.length > 0 || phase !== 'idle') && (
            <div className="steps" style={{ width: '100%', maxWidth: 320 }}>
              {SLOTS.map((s, i) => (
                <span key={s} className={i < progress ? 'done' : ''} />
              ))}
            </div>
          )}
        </div>
      </div>

      {turns.length > 0 && (
        <div className="card">
          <div className="chat">
            {turns.map((t, i) => (
              <div key={i} className={`bubble ${t.who}`}>
                {t.text}
                {t.note && <span className={`tag ${t.note === 'पक्का' ? 'ok' : ''}`}>{t.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  )
}

function silentWav(): Blob {
  const n = 8000
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  return new Blob([buf], { type: 'audio/wav' })
}

function emptyParse() {
  return { text: '', values: [], numbers: [], bp: null, doubt: false, reasons: [], is_correction: false }
}
