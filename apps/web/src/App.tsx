import { useEffect, useState } from 'react'
import { health } from './lib/api'
import { confirmAllEnabled } from './lib/dialogue'
import Capture from './pages/Capture'
import CheckIn from './pages/CheckIn'
import EminRecorder from './pages/EminRecorder'
import History from './pages/History'
import TierARecorder from './pages/TierARecorder'

type Tab = 'record' | 'checkin' | 'history'

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
  const [mode, setMode] = useState<string>('waking')
  const [streaming, setStreaming] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [tab, setTab] = useState<Tab>('record')
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
        if (!cancelled) {
          setMode(h.mode)
          setStreaming(h.streaming !== false)
        }
      } catch {
        if (cancelled) return
        attempts++
        setMode(attempts < 18 ? 'waking' : 'offline')
        if (attempts < 18) setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [])

  if (route.startsWith('#/record-emin')) return <EminRecorder />
  if (route.startsWith('#/record-tier-a')) return <TierARecorder />

  const statusText = mode === 'live' ? 'Gnani live' : mode === 'mock' ? 'demo mode' : mode === 'waking' ? 'server jaag raha hai' : 'offline'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo" aria-hidden="true">
            स
          </div>
          <div className="brand">
            <strong>सेहत डायरी</strong>
            <span>बोलो, सुनो, पक्का करो</span>
          </div>
          <div className="spacer" />
          <span className={`pill ${mode}`}>{statusText}</span>
        </div>
      </header>

      <nav className="tabbar" aria-label="sections">
        <div className="tabbar-inner">
          <button className={`tab ${tab === 'record' ? 'active' : ''}`} onClick={() => setTab('record')}>
            <span className="ico">🎙</span>बोलें
          </button>
          <button className={`tab ${tab === 'checkin' ? 'active' : ''}`} onClick={() => setTab('checkin')}>
            <span className="ico">☎</span>चेक-इन
          </button>
          <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            <span className="ico">📒</span>इतिहास
          </button>
        </div>
      </nav>

      <main className="content">
        {mode === 'waking' && <div className="notice">Server free plan par sota hai; jaagne mein ek minute lag sakta hai. Page khud update hoga.</div>}
        {tab === 'record' && (
          <Capture apiMode={mode} streamingAvailable={streaming} confirmAll={confirmAll} onToggleConfirmAll={toggleConfirmAll} onSaved={() => setRefreshKey((k) => k + 1)} />
        )}
        {tab === 'checkin' && <CheckIn apiMode={mode} onSaved={() => setRefreshKey((k) => k + 1)} />}
        {tab === 'history' && <History refreshKey={refreshKey} allowSample={mode === 'mock'} />}
        <footer className="disclaimer">
          Yeh medical device nahi hai. Koi salah nahi, sirf record. Demo mein sab data synthetic hai.
          <br />
          Built on Gnani Prisma and Timbre · <a href="https://github.com/gativarshney/sehat-diary">open source</a> · <a href="#/record-emin">E-min</a> ·{' '}
          <a href="#/record-tier-a">Tier A</a>
        </footer>
      </main>
    </div>
  )
}
