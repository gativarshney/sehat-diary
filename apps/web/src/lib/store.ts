/** Minimal IndexedDB store for entries. Offline-first; no sync in this milestone. */

export type Kind = 'bp' | 'sugar' | 'weight' | 'medicine' | 'other'

export interface Entry {
  id: string
  ts: number
  kind: Kind
  heard: string // raw transcript
  heardValues: number[] // what the parser extracted
  finalValues: number[] // what the user confirmed
  doubt: boolean
  reasons: string[]
  corrected: boolean
  note?: string
}

const DB = 'sehat-diary'
const STORE = 'entries'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveEntry(e: Entry): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(e)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function listEntries(limit = 200): Promise<Entry[]> {
  const db = await open()
  const out = await new Promise<Entry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).index('ts').openCursor(null, 'prev')
    const rows: Entry[] = []
    req.onsuccess = () => {
      const c = req.result
      if (c && rows.length < limit) {
        rows.push(c.value as Entry)
        c.continue()
      } else resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
  db.close()
  return out
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export function toCsv(rows: Entry[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = ['time,kind,final_values,heard_values,heard_text,doubt,corrected']
  for (const r of rows) {
    lines.push(
      [new Date(r.ts).toISOString(), r.kind, r.finalValues.join(' '), r.heardValues.join(' '), esc(r.heard), r.doubt, r.corrected].join(','),
    )
  }
  return lines.join('\n')
}
