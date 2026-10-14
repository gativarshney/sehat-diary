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
const MOCK_SCRIPT = ['haan le li', 'ek sau atthais by bayasi', 'sugar dedh sau', 'haan']

/**
 * Proactive half-duplex check-in: the app asks, then listens; it reads back only doubtful values.
 * Audio in/out is injected here; all dialogue decisions live in lib/checkin.ts.
 */
export default function CheckIn({ apiMode, onSaved }: { apiMode: string; onSaved: () => void }) {
  const [phase, setPhase] = useState<UiPhase>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [err, setErr] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const rec = useRef<Recorder | null>(null)
  const stopResolver = useRef<(() => void) | null>(null)
  const isMock = apiMode !== 'live'
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
    mockIdx.current = 0
    try {
      let { state, step } = startCheckIn(['medicine', 'bp', 'sugar'])
      while (step.kind !== 'done') {
        await speak(step.text)
        if (step.kind === 'say') {
          ;({ state, step } = answer(state, step, '', emptyParse()))
          continue
        }
        const heard = await listenOnce()
        const p = await parse(heard)
        const prev: Step = step
        ;({ state, step } = answer(state, prev, heard, { ...p }))
        const last = state.answers[state.answers.length - 1]
        const note = prev.kind === 'confirm' ? (last?.corrected ? 'corrected' : 'confirmed') : p.doubt ? `doubt: ${p.reasons.join(', ')}` : undefined
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
        doubt: a.reasons.length > 0, // was doubtful at capture time, even if confirmed afterwards
        reasons: a.reasons,
        corrected: a.corrected,
        note: a.slot === 'medicine' ? (a.taken ? 'li' : 'nahi li') : undefined,
      }
      await saveEntry(e)
    }
  }

  return (
    <section className="checkin">
      <audio ref={audio} hidden />
      <div className="row between">
        <h2>रोज़ का चेक-इन</h2>
        {phase === 'idle' || phase === 'done' ? (
          <button onClick={run}>{isMock ? 'Run sample check-in' : 'शुरू करें'}</button>
        ) : phase === 'listening' ? (
          <button className="danger" onClick={stopListening}>
            सुन रहा हूँ... (रोकें)
          </button>
        ) : (
          <button disabled>{phase === 'speaking' ? 'बोल रहा हूँ...' : 'समझ रहा हूँ...'}</button>
        )}
      </div>
      <ul className="turns">
        {turns.map((t, i) => (
          <li key={i} className={t.who}>
            <span className="who">{t.who === 'app' ? '🔊' : '🎙'}</span> {t.text}
            {t.note && <span className="tag">{t.note}</span>}
          </li>
        ))}
      </ul>
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
