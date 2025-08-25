import axios from 'axios'

const BASE_URL = 'http://localhost:8080'

// Subscribe an email address to alert notifications
export async function subscribeToAlerts(email: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/alerts/subscribe`,
      { email },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    // Prefer server-provided error message, fallback to generic message
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Subscription failed'
    throw new Error(message)
  }
}


