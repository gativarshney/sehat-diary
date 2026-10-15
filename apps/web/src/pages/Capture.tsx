import { useEffect, useRef, useState } from 'react'
import { API_BASE, parse, stt, tts, type ParseResult } from '../lib/api'
import { guessKind, interpretConfirmation, readbackText } from '../lib/dialogue'
import { Recorder } from '../lib/recorder'
import { saveEntry, type Entry, type Kind } from '../lib/store'
import { StreamClient, wsBaseFromApiBase } from '../lib/stream'

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

const KIND_LABEL: Record<Kind, string> = { bp: 'बीपी', sugar: 'शुगर', weight: 'वज़न', medicine: 'दवाई', other: 'नोट' }
const KIND_UNIT: Record<Kind, string> = { bp: 'mmHg', sugar: 'mg/dL', weight: 'kg', medicine: '', other: '' }

interface Props {
  apiMode: string
  streamingAvailable?: boolean
  confirmAll: boolean
  onToggleConfirmAll: (v: boolean) => void
  onSaved: () => void
}

/**
 * Push-to-talk capture with doubt-aware read-back.
 * Flow: listen -> STT -> parse -> read back (question only if doubtful, or always in confirm-all mode) -> confirm/correct -> save.
 */
export default function Capture({ apiMode, streamingAvailable = true, confirmAll, onToggleConfirmAll, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mockText, setMockText] = useState(SAMPLES[0])
  const [phoneMode, setPhoneMode] = useState<'off' | 'quiet' | 'noisy'>('off')
  const [streaming, setStreaming] = useState(false)
  const [liveSegments, setLiveSegments] = useState<string[]>([])
  const rec = useRef<Recorder | null>(null)
  const streamRef = useRef<StreamClient | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const stopResolver = useRef<(() => void) | null>(null)
  const isMock = apiMode !== 'live'
  const ready = apiMode === 'live' || apiMode === 'mock'

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
    const { blob, seconds } = await rec.current.stop(phoneMode === 'off' ? null : { noiseLevel: phoneMode === 'noisy' ? 0.12 : 0.03, seed: 42 })
    rec.current = null
    return { blob, seconds }
  }

  async function listenStreaming(): Promise<string> {
    setLiveSegments([])
    const sc = new StreamClient(wsBaseFromApiBase(API_BASE), 'hi-IN')
    sc.onEvent = (e) => {
      if (e.type === 'transcript' && e.text) setLiveSegments((s) => [...s, e.text!])
    }
    streamRef.current = sc
    await sc.start()
    setPhase('listening')
    await new Promise<void>((res) => {
      stopResolver.current = res
    })
    setPhase('processing')
    const text = await sc.stop()
    streamRef.current = null
    return text
  }

  function stopListening() {
    stopResolver.current?.()
    stopResolver.current = null
  }

  async function captureReading(sample = false) {
    setErr(null)
    setDraft(null)
    try {
      let transcript: string
      if (sample) {
        const { encodeWav } = await import('../lib/wav')
        const s = await stt(encodeWav(new Int16Array(8000), 16000), isMock ? mockText : undefined)
        transcript = s.transcript
      } else if (streaming && streamingAvailable) {
        transcript = await listenStreaming()
      } else {
        const { blob } = await listen()
        setPhase('processing')
        const s = await stt(blob, isMock ? mockText : undefined)
        transcript = s.transcript
      }
      setPhase('processing')
      const p = await parse(transcript)
      const kind = guessKind(transcript, p)
      const rb = readbackText(kind, p, confirmAll)
      const d: Draft = {
        kind,
        heard: transcript,
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
      let next = [...draft.values]
      if (draft.kind === 'bp' && values.length === 1) next[0] = values[0]
      else if (draft.kind === 'bp' && values.length >= 2) next = [values[0], values[1]]
      else next = [values[0]]
      const d2 = { ...draft, values: next, corrected: true }
      setDraft(d2)
      const say = readbackText(d2.kind, { ...d2.parsed, values: next, bp: d2.kind === 'bp' ? [next[0], next[1]] : null, doubt: false }, false)
      await speak(say.text)
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
    const v = prompt('सही नंबर (जैसे 128 या 128 82):')
    if (!v) return
    const nums = v.split(/[\s/]+/).map(Number).filter((n) => !Number.isNaN(n))
    if (nums.length) void applyConfirmation(nums, 'correct')
  }

  const idle = phase === 'idle' || phase === 'saved' || phase === 'error'
  const micLabel =
    phase === 'listening'
      ? 'सुन रहा हूँ… दबाकर रोकें'
      : phase === 'processing'
        ? 'समझ रहा हूँ'
        : phase === 'readback'
          ? 'बोल रहा हूँ'
          : phase === 'confirming'
            ? 'पुष्टि कीजिए'
            : ready
              ? 'दबाएँ और बोलें'
              : 'server ka intezaar'

  return (
    <section>
      <audio ref={audio} hidden />
      <div className="card hero">
        <h1>रीडिंग बोलिए</h1>
        <p>BP, sugar, vajan ya dawai: Hinglish mein bolo. Jahan shak ho, app wahin poochega.</p>
        <div className="chips">
          <span className="chip">"BP ek sau atthais by bayasi"</span>
          <span className="chip">"sugar fasting dedh sau"</span>
          <span className="chip">"vajan chauvan point paanch"</span>
        </div>
        <div className="mic-wrap">
          {idle ? (
            <button className="mic" onClick={() => captureReading()} disabled={!ready} aria-label="record a reading">
              🎙
            </button>
          ) : phase === 'listening' ? (
            <button className="mic listening" onClick={stopListening} aria-label="stop listening">
              ■
            </button>
          ) : (
            <button className="mic busy" disabled aria-label={micLabel}>
              {phase === 'readback' ? '🔊' : '…'}
            </button>
          )}
          <div className={`mic-label ${phase === 'processing' ? 'dots' : ''}`}>{micLabel}</div>
          {streaming && streamingAvailable && phase === 'listening' && liveSegments.length > 0 && <div className="small muted">{liveSegments.join(' · ')}</div>}
          {isMock && ready && (
            <button className="btn sm ghost" onClick={() => captureReading(true)} disabled={!idle}>
              bina mic ke sample chalayein
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div className="card result">
          <div className="cols">
            <div className="col">
              <div className="label">सुना गया</div>
              <div className="heard">{draft.heard}</div>
              <div className="tiny" style={{ marginTop: 6 }}>
                {draft.parsed.values.length ? `numbers: ${draft.parsed.values.join(', ')}` : 'koi number nahi mila'}
                {draft.parsed.doubt ? ` · shak: ${draft.parsed.reasons.join(', ')}` : draft.parsed.values.length ? ' · pakka' : ''}
              </div>
            </div>
            <div className="col">
              <div className="label">रिकॉर्ड</div>
              <div className="final">
                {draft.kind === 'medicine' ? 'दवाई ली' : draft.kind === 'bp' && draft.values.length >= 2 ? `${draft.values[0]}/${draft.values[1]}` : draft.values.join(' ')}
                {KIND_UNIT[draft.kind] && draft.values.length > 0 && <small>{KIND_UNIT[draft.kind]}</small>}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="tag info">{KIND_LABEL[draft.kind]}</span>
                {draft.corrected && <span className="tag">सुधारा</span>}
                {phase === 'saved' && <span className="tag ok">सेव हो गया</span>}
              </div>
            </div>
          </div>
          <div className="readback">
            <span className="spk">🔊</span>
            <span>{draft.readback}</span>
          </div>
          {phase === 'confirming' && (
            <div className="confirm">
              <button className="btn teal" onClick={() => applyConfirmation(null, 'yes')}>
                हाँ, सही है
              </button>
              <button className="btn" onClick={confirmByVoice}>
                बोलकर ठीक करें
              </button>
              <button className="btn ghost" onClick={manualCorrect}>
                टाइप करें
              </button>
            </div>
          )}
        </div>
      )}
      {err && <div className="error">{err}</div>}

      <details className="dev">
        <summary>Settings and developer options</summary>
        <div className="grid">
          <label>
            <input type="checkbox" checked={confirmAll} onChange={(e) => onToggleConfirmAll(e.target.checked)} /> Har value confirm karo (E-min rule; Tier A tak on)
          </label>
          <label>
            Phone mode (8 kHz band-limit, in-browser)
            <select value={phoneMode} onChange={(e) => setPhoneMode(e.target.value as 'off' | 'quiet' | 'noisy')} disabled={streaming}>
              <option value="off">off</option>
              <option value="quiet">quiet line</option>
              <option value="noisy">noisy line</option>
            </select>
          </label>
          {streamingAvailable && (
            <label>
              <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} /> Streaming (live segments, beta)
            </label>
          )}
          {isMock && (
            <label>
              Mock transcript (demo mode, no credits)
              <select value={mockText} onChange={(e) => setMockText(e.target.value)}>
                {SAMPLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </details>
    </section>
  )
}
