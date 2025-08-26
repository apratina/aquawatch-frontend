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


