import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app'
import { GnaniClient } from '../src/gnani'
import { Ledger } from '../src/ledger'

export function wavBytes(seconds: number, rate = 16000): Uint8Array<ArrayBuffer> {
  const n = Math.round(rate * seconds)
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
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  return new Uint8Array(buf)
}

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'sehat-'))
}

export function mockApp(mockTranscripts: Record<string, string> = {}) {
  const dir = tmp()
  const ledger = new Ledger(join(dir, 'ledger.csv'), { maxCredits: 1 })
  const client = new GnaniClient({ mode: 'mock', ledger, mockTranscripts })
  return { app: buildApp({ client, cacheDir: join(dir, 'tts') }), ledger, client, dir }
}
