import { http } from './http'

// Subscribe an email address to alert notifications
export async function subscribeToAlerts(email: string): Promise<void> {
  try {
    await http.post(
      `/alerts/subscribe`,
      { email },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    // Prefer server-provided error message, fallback to generic message
    const data = (err as any)?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Subscription failed'
    throw new Error(message)
  }
}


export type BackendAlert = {
  createdon_ms: number
  alert_id: string
  alert_name: string
  s3_signed_url?: string
  severity?: 'low' | 'medium' | 'high' | string
  sites_impacted?: string[]
  anomaly_date?: string
}

export async function getRecentAlerts(minutes: number = 10): Promise<{ alerts: BackendAlert[]; since_ms?: number }> {
  try {
    const res = await http.get('/alerts', { params: { minutes } })
    const data = res?.data
    const alerts: BackendAlert[] = Array.isArray(data?.alerts) ? data.alerts : []
    return { alerts, since_ms: typeof data?.since_ms === 'number' ? data.since_ms : undefined }
  } catch (err: any) {
    const data = (err as any)?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Failed to load alerts'
    throw new Error(message)
  }
}


