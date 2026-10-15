import { useEffect, useState } from 'react'
import { health } from './lib/api'
import { confirmAllEnabled } from './lib/dialogue'
import Capture from './pages/Capture'
import CheckIn from './pages/CheckIn'
import EminRecorder from './pages/EminRecorder'
import History from './pages/History'
import TierARecorder from './pages/TierARecorder'

function useHashRoute(): string {
  const [route, setRoute] = useState(window.location.hash || '#/')
  useEffect(() => {
    const on = () => setRoute(window.location.hash || '#/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export default function App() {
  const route = useHashRoute()
  const [mode, setMode] = useState<string>('offline')
  const [refreshKey, setRefreshKey] = useState(0)
  const [confirmAll, setConfirmAll] = useState(confirmAllEnabled())
  function toggleConfirmAll(v: boolean) {
    setConfirmAll(v)
    try {
      localStorage.setItem('sehat.confirmAll', v ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  // The free API instance sleeps when idle; poll health until it answers (about a minute on cold start).
  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const tick = async () => {
      try {
        const h = await health()
        if (!cancelled) setMode(h.mode)
      } catch {
        if (cancelled) return
        attempts++
        setMode(attempts < 12 ? 'waking' : 'offline')
        if (attempts < 12) setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [])

  if (route.startsWith('#/record-emin')) return <EminRecorder />
  if (route.startsWith('#/record-tier-a')) return <TierARecorder />

  return (
    <main className="wrap">
      <header className="row between">
        <h1>सेहत डायरी</h1>
        <span className={`pill ${mode}`}>
          {mode === 'live' ? 'live' : mode === 'mock' ? 'mock (no credits)' : mode === 'waking' ? 'server waking up...' : 'API offline'}
        </span>
      </header>
      <p className="muted">
        बोलिए: "BP ek sau atthais by bayasi", "sugar fasting dedh sau", "weight chauvan point paanch". जहाँ शक हो, वहीं पूछेगा।
      </p>
      <Capture apiMode={mode} onSaved={() => setRefreshKey((k) => k + 1)} />
      <CheckIn apiMode={mode} onSaved={() => setRefreshKey((k) => k + 1)} />
      <History refreshKey={refreshKey} allowSample={mode === 'mock'} />
      <p className="muted small">
        <label>
          <input type="checkbox" checked={confirmAll} onChange={(e) => toggleConfirmAll(e.target.checked)} /> confirm every value (on until the doubt
          detector is validated)
        </label>
      </p>
      <footer className="muted small">
        Not a medical device. No advice. Synthetic data in demos. Built on Gnani Prisma and Timbre. <a href="#/record-emin">E-min recorder</a> · <a href="#/record-tier-a">Tier A recorder</a>
      </footer>
    </main>
  )
}
