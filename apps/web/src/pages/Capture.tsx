import { useEffect, useRef, useState } from 'react'
import { parse, stt, tts, type ParseResult } from '../lib/api'
import { guessKind, interpretConfirmation, readbackText } from '../lib/dialogue'
import { Recorder } from '../lib/recorder'
import { saveEntry, type Entry, type Kind } from '../lib/store'

type Phase = 'idle' | 'listening' | 'processing' | 'readback' | 'confirming' | 'saved' | 'error'

interface Draft {
  kind: Kind
  heard: string
  parsed: ParseResult
  values: number[]
  readback: string
  asksConfirm: boolean
  corrected: boolean
}

const SAMPLES = [
  'बीपी एक सौ अट्ठाईस बाय बयासी',
  'शुगर फास्टिंग डेढ़ सौ',
  'वेट चौवन पॉइंट पाँच किलो',
  'बीपी एक सौ चौवन चौरानवे',
]

/**
 * Push-to-talk capture with doubt-aware read-back.
 * Flow: listen -> STT -> parse -> read back (question only if doubtful) -> confirm/correct -> save.
 */
export default function Capture({ apiMode, onSaved }: { apiMode: string; onSaved: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mockText, setMockText] = useState(SAMPLES[0])
  const rec = useRef<Recorder | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const isMock = apiMode !== 'live'

  useEffect(
    () => () => {
      void rec.current?.stop().catch(() => undefined)
    },
    [],
  )

  async function speak(text: string): Promise<void> {
    const { url } = await tts(text)
    if (!audio.current) return
    audio.current.src = url
    try {
      await audio.current.play()
      await new Promise<void>((res) => {
        audio.current!.onended = () => res()
        audio.current!.onerror = () => res()
      })
    } catch {
      /* autoplay blocked or mock bytes: continue silently */
    }
  }

  async function listen(): Promise<{ blob: Blob; seconds: number }> {
    rec.current = new Recorder()
    await rec.current.start()
    setPhase('listening')
    await new Promise<void>((res) => {
      stopResolver.current = res
    })
    const out = await rec.current.stop()
    rec.current = null
    return out
  }
  const stopResolver = useRef<(() => void) | null>(null)
  function stopListening() {
    stopResolver.current?.()
    stopResolver.current = null
  }

  /** Sample path: no microphone, uses the selected mock transcript through the same pipeline. */
  async function captureSample() {
    return captureReading(true)
  }

  async function captureReading(sample = false) {
    setErr(null)
    setDraft(null)
    try {
      let blob: Blob
      if (sample) {
        // 0.5 s of silence as a stand-in clip; the API is in mock mode so no credits are involved
        const { encodeWav } = await import('../lib/wav')
        blob = encodeWav(new Int16Array(8000), 16000)
      } else {
        blob = (await listen()).blob
      }
      setPhase('processing')
      const s = await stt(blob, isMock ? mockText : undefined)
      const p = await parse(s.transcript)
      const kind = guessKind(s.transcript, p)
      const rb = readbackText(kind, p)
      const d: Draft = {
        kind,
        heard: s.transcript,
        parsed: p,
        values: p.bp ? [...p.bp] : p.values,
        readback: rb.text,
        asksConfirm: rb.asksConfirm,
        corrected: false,
      }
      setDraft(d)
      setPhase('readback')
      await speak(rb.text)
      if (rb.asksConfirm) setPhase('confirming')
      else if (p.values.length) await commit(d)
      else setPhase('idle')
    } catch (e) {
      setErr(String(e))
      setPhase('error')
    }
  }

  async function confirmByVoice() {
    if (!draft) return
    try {
      const { blob } = await listen()
      setPhase('processing')
      const s = await stt(blob, isMock ? 'हाँ' : undefined)
      const p = await parse(s.transcript)
      const c = interpretConfirmation(s.transcript, p)
      await applyConfirmation(c.type === 'correct' ? c.values : null, c.type)
    } catch (e) {
      setErr(String(e))
      setPhase('error')
    }
  }

  async function applyConfirmation(values: number[] | null, type: string) {
    if (!draft) return
    if (type === 'yes') return commit(draft)
    if (type === 'correct' && values) {
      // one-field correction: replace the doubtful value(s); for BP a single number replaces systolic
      let next = [...draft.values]
      if (draft.kind === 'bp' && values.length === 1) next[0] = values[0]
      else if (draft.kind === 'bp' && values.length >= 2) next = [values[0], values[1]]
      else next = [values[0]]
      const d2 = { ...draft, values: next, corrected: true }
      setDraft(d2)
      const kindText = readbackText(d2.kind, { ...d2.parsed, values: next, bp: d2.kind === 'bp' ? [next[0], next[1]] : null, doubt: false })
      await speak(kindText.text)
      return commit(d2)
    }
    if (type === 'no') {
      setPhase('confirming')
      await speak('ठीक है, सही नंबर बोलिए।')
      return
    }
    setPhase('confirming')
  }

  async function commit(d: Draft) {
    const e: Entry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: d.kind,
      heard: d.heard,
      heardValues: d.parsed.bp ? [...d.parsed.bp] : d.parsed.values,
      finalValues: d.values,
      doubt: d.parsed.doubt,
      reasons: d.parsed.reasons,
      corrected: d.corrected,
    }
    await saveEntry(e)
    setDraft(d)
    setPhase('saved')
    onSaved()
  }

  function manualCorrect() {
    const v = prompt('सही नंबर (e.g. 128 or 128 82):')
    if (!v) return
    const nums = v.split(/[\s/]+/).map(Number).filter((n) => !Number.isNaN(n))
    if (nums.length) void applyConfirmation(nums, 'correct')
  }

  return (
    <section className="capture">
      <audio ref={audio} hidden />
      {isMock && (
        <div className="mockbar">
          <label>
            Mock transcript (API is in mock mode, no credits used):{' '}
            <select value={mockText} onChange={(e) => setMockText(e.target.value)}>
              {SAMPLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>{' '}
          <button onClick={captureSample} disabled={phase !== 'idle' && phase !== 'saved' && phase !== 'error'}>
            Try sample (no mic)
          </button>
        </div>
      )}

      <div className="big">
        {phase === 'idle' || phase === 'saved' || phase === 'error' ? (
          <button className="mic" onClick={() => captureReading()}>
            बोलिए
          </button>
        ) : phase === 'listening' ? (
          <button className="mic active" onClick={stopListening}>
            सुन रहा हूँ... (रोकें)
          </button>
        ) : (
          <button className="mic" disabled>
            {phase === 'processing' ? 'समझ रहा हूँ...' : phase === 'readback' ? 'बोल रहा हूँ...' : 'पुष्टि करें'}
          </button>
        )}
      </div>

      {draft && (
        <div className="card">
          <div className="row">
            <div>
              <div className="label">सुना (heard)</div>
              <div className="heard">{draft.heard}</div>
              <div className="muted">parser: {draft.parsed.values.join(', ') || 'no number'} {draft.parsed.doubt ? `· doubt: ${draft.parsed.reasons.join(', ')}` : '· confident'}</div>
            </div>
            <div>
              <div className="label">रिकॉर्ड (record)</div>
              <div className="final">
                {draft.kind} {draft.kind === 'bp' && draft.values.length >= 2 ? `${draft.values[0]} / ${draft.values[1]}` : draft.values.join(' ')}
                {draft.corrected && <span className="tag">corrected</span>}
                {phase === 'saved' && <span className="tag ok">saved</span>}
              </div>
            </div>
          </div>
          <div className="readback muted">🔊 {draft.readback}</div>
          {phase === 'confirming' && (
            <div className="confirm">
              <button onClick={() => applyConfirmation(null, 'yes')}>हाँ, सही है</button>
              <button onClick={confirmByVoice}>बोलकर ठीक करें</button>
              <button onClick={manualCorrect}>टाइप करके ठीक करें</button>
            </div>
          )}
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  )
}
