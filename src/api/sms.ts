import { http } from './http'

export type SendCodeResponse = {
  session_id?: string
  request_id?: string
  ttl_sec?: number
}

export type VerifyCodeResponse = {
  token: string
  expires_in_sec?: number
}

export async function sendVerificationCode(phoneE164: string): Promise<SendCodeResponse> {
  try {
    const { data } = await http.post<SendCodeResponse>(`/sms/send`, { phone_e164: phoneE164 }, { headers: { 'Content-Type': 'application/json' } })
    console.log('sendVerificationCode', data)
    return data
  } catch (error: any) {
    if ((error as any)?.response?.data?.error) throw new Error((error as any).response.data.error)
    throw error
  }
}

export async function verifyCode(sessionId: string, code: string): Promise<VerifyCodeResponse> {
  try {
    const { data } = await http.post<VerifyCodeResponse>(`/sms/verify`, { session_id: sessionId, code }, { headers: { 'Content-Type': 'application/json' } })
    console.log('verifyCode', data)
    return data
  } catch (error: any) {
    if ((error as any)?.response?.data?.error) throw new Error((error as any).response.data.error)
    throw error
  }
}


