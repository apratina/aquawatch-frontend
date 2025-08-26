import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'

export const http = axios.create({ baseURL: API_BASE })

http.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('aquawatch_session')
    if (raw) {
      const s = JSON.parse(raw)
      if (s?.token && typeof s?.expiresAt === 'number' && Date.now() < s.expiresAt) {
        config.headers = config.headers || {}
        ;(config.headers as any)['X-Session-Token'] = s.token
      }
    }
  } catch {}
  return config
})


