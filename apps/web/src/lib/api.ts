export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export interface ParseResult {
  text: string
  values: number[]
  numbers: { value: number; source: string; span: [number, number] }[]
  bp: [number, number] | null
  doubt: boolean
  reasons: string[]
  is_correction: boolean
}

export interface SttResult {
  transcript: string
  request_id: string | null
  mock: boolean
  seconds: number
}

export async function stt(blob: Blob, mockText?: string): Promise<SttResult> {
  const fd = new FormData()
  fd.append('audio', blob, 'clip.wav')
  if (mockText) fd.append('mock_text', mockText)
  const r = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`stt ${r.status}: ${await r.text()}`)
  return r.json()
}

export async function parse(text: string): Promise<ParseResult> {
  const r = await fetch(`${API_BASE}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new Error(`parse ${r.status}`)
  return r.json()
}

export async function tts(text: string): Promise<{ url: string; mock: boolean }> {
  const r = await fetch(`${API_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) throw new Error(`tts ${r.status}: ${await r.text()}`)
  const mock = r.headers.get('X-Mock') === 'true'
  const blob = await r.blob()
  return { url: URL.createObjectURL(blob), mock }
}

export async function health(): Promise<{ ok: boolean; mode: string }> {
  const r = await fetch(`${API_BASE}/healthz`)
  return r.json()
}
