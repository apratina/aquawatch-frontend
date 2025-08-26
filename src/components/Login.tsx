import React, { useCallback, useMemo, useState } from 'react'
import { sendVerificationCode, verifyCode } from '../api/sms'

export function Login({ onAuthenticated }: { onAuthenticated: (token: string, expiresAtMs: number) => void }) {
  const [step, setStep] = useState<'enter' | 'code' | 'verifying'>('enter')
  const [phone, setPhone] = useState('')
  const [sessionId, setSessionId] = useState<string>('')
  const [code, setCode] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [cooldownUntil, setCooldownUntil] = useState<number>(0)

  const canResend = useMemo(() => Date.now() >= cooldownUntil, [cooldownUntil])

  const onSend = useCallback(async () => {
    const e164 = phone.trim()
    if (!/^\+?[1-9]\d{7,15}$/.test(e164)) {
      setError('Enter a valid phone number in E.164 format, e.g. +14155551234')
      return
    }
    try {
      setError('')
      const resp = await sendVerificationCode(e164.startsWith('+') ? e164 : `+${e164}`)
      const ttlSec = Math.max(15, Math.min(120, Number(resp?.ttl_sec || 30)))
      setCooldownUntil(Date.now() + ttlSec * 1000)
      setSessionId(resp.session_id || resp.request_id || '')
      setStep('code')
    } catch (e: any) {
      setError(e?.message || 'Failed to send code')
    }
  }, [phone])

  const onVerify = useCallback(async () => {
    if (!sessionId) { setError('Missing session'); return }
    if (!/^\d{4,8}$/.test(code.trim())) { setError('Enter the 6-digit code'); return }
    try {
      setStep('verifying')
      setError('')
      const { token, expires_in_sec } = await verifyCode(sessionId, code.trim())
      if (!token) {
        setStep('code')
        setError('Invalid or expired code')
        return
      }
      const ttl = Number(expires_in_sec || 3600)
      const expiresAtMs = Date.now() + ttl * 1000
      onAuthenticated(token, expiresAtMs)
    } catch (e: any) {
      setStep('code')
      setError(e?.message || 'Verification failed')
    }
  }, [sessionId, code, onAuthenticated])

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: 360, maxWidth: '90vw', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Sign in with your phone</div>
        <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>We will send a one-time passcode to your phone number.</div>
        {step === 'enter' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <input
              type="tel"
              placeholder="+14155551234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}
            />
            <button onClick={onSend} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#1f2937', color: '#fff' }}>Send code</button>
          </div>
        )}

        {step !== 'enter' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: '#374151' }}>Code sent to <strong>{phone || 'your phone'}</strong></div>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter 6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep('enter')} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: '#f3f4f6', color: '#374151' }}>Change number</button>
              <button onClick={onVerify} disabled={step==='verifying'} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', background: step==='verifying' ? '#9ca3af' : '#1f2937', color: '#fff', flex: 1 }}>{step==='verifying' ? 'Verifying…' : 'Verify'}</button>
            </div>
            <button
              onClick={onSend}
              disabled={!canResend}
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', background: canResend ? '#f3f4f6' : '#f9fafb', color: canResend ? '#374151' : '#9ca3af' }}
            >
              {canResend ? 'Resend code' : 'Resend available soon…'}
            </button>
          </div>
        )}

        {error && <div role="alert" style={{ marginTop: 8, color: '#991b1b', fontSize: 12 }}>{error}</div>}
      </div>
    </div>
  )
}


