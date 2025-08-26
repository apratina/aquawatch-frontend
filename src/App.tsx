// App root: hosts the map shell and global styles
import './App.css'
import { MapView } from './components/MapView'
import { Login } from './components/Login'
import { useEffect, useMemo, useState } from 'react'

function App() {
  const LOGIN_ENABLED = (import.meta.env.VITE_ENABLE_LOGIN ?? 'true') === 'true'
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)

  // Load session on boot
  useEffect(() => {
    try {
      const raw = localStorage.getItem('aquawatch_session')
      if (!raw) return
      const s = JSON.parse(raw)
      if (s?.token && typeof s?.expiresAt === 'number' && Date.now() < s.expiresAt) {
        setToken(s.token)
        setExpiresAt(s.expiresAt)
      } else if (s?.expiresAt && Date.now() >= s.expiresAt) {
        localStorage.removeItem('aquawatch_session')
      }
    } catch {}
  }, [])

  // Auto-expire session
  useEffect(() => {
    if (!expiresAt) return
    const ms = Math.max(0, expiresAt - Date.now())
    const id = setTimeout(() => {
      setToken(null)
      setExpiresAt(0)
      localStorage.removeItem('aquawatch_session')
    }, ms)
    return () => clearTimeout(id)
  }, [expiresAt])

  const onAuthenticated = (tkn: string, exp: number) => {
    setToken(tkn)
    setExpiresAt(exp)
    localStorage.setItem('aquawatch_session', JSON.stringify({ token: tkn, expiresAt: exp }))
  }

  const isAuthed = useMemo(() => Boolean(token && Date.now() < expiresAt), [token, expiresAt])

  return (
    <div className="app-shell" style={{ height: '100vh', width: '100%' }}>
      {LOGIN_ENABLED ? (isAuthed ? <MapView /> : <Login onAuthenticated={onAuthenticated} />) : <MapView />}
    </div>
  )
}

export default App
