import { useCallback, useMemo, useState } from 'react'
import { sendVerificationCode, verifyCode } from '../api/sms'
import { buttonStyle } from './buttonStyles'

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
    <div style={{ minHeight: '100vh', width: '100%', position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 35%, #eef2ff 100%)' }}>
      {/* Decorative blobs */}
      <div style={{ position: 'absolute', top: -80, left: -80, width: 280, height: 280, borderRadius: 9999, background: 'radial-gradient(closest-side, rgba(59,130,246,0.25), rgba(59,130,246,0))' }} />
      <div style={{ position: 'absolute', bottom: -100, right: -100, width: 320, height: 320, borderRadius: 9999, background: 'radial-gradient(closest-side, rgba(99,102,241,0.22), rgba(99,102,241,0))' }} />

      {/* Two-column layout */}
      <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', position: 'relative', width: 'min(1040px, 100%)', margin: '0 auto' }}>
        {/* Left: brand and zen statement */}
        <div style={{ padding: '24px 32px', display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #2563eb, #3b82f6)', color: '#fff', fontSize: 28 }}>🌊</div>
              <div style={{ fontWeight: 900, fontSize: 48, lineHeight: 1.05, color: '#1f2937', letterSpacing: 0.2 }}>AquaWatch</div>
            </div>
            <div style={{ marginTop: 12, fontSize: 22, color: '#374151' }}>Know your water. Act with confidence.</div>
          </div>
        </div>

        {/* Right: login card */}
        <div style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ width: 420, maxWidth: '92vw', border: '1px solid #e5e7eb', borderRadius: 16, padding: 20, background: '#ffffffcc', backdropFilter: 'blur(6px)', boxShadow: '0 10px 30px rgba(2, 6, 23, 0.08)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Sign in with your phone</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 14 }}>We will send a one-time passcode to your phone number.</div>
            {step === 'enter' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  type="tel"
                  placeholder="+14155551234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ border: '1px solid #d1d5db', borderRadius: 10, padding: '12px 14px', fontSize: 14 }}
                />
                <button onClick={onSend} style={{ ...buttonStyle({ variant: 'primary' }) }}>Send code</button>
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
                  style={{ border: '1px solid #d1d5db', borderRadius: 10, padding: '12px 14px', fontSize: 16, letterSpacing: 2 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('enter')} style={{ ...buttonStyle({ variant: 'secondary' }) }}>Change number</button>
                  <button onClick={onVerify} disabled={step==='verifying'} style={{ flex: 1, ...buttonStyle({ variant: 'primary', disabled: step==='verifying' }) }}>{step==='verifying' ? 'Verifying…' : 'Verify'}</button>
                </div>
                <button
                  onClick={onSend}
                  disabled={!canResend}
                  style={{ ...buttonStyle({ variant: canResend ? 'secondary' : 'secondary', disabled: !canResend }) }}
                >
                  {canResend ? 'Resend code' : 'Resend available soon…'}
                </button>
              </div>
            )}

            {error && <div role="alert" style={{ marginTop: 8, color: '#991b1b', fontSize: 12 }}>{error}</div>}

            <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>Standard SMS rates may apply. By continuing you agree to receive one-time passcodes for authentication.</div>
          </div>
        </div>
      </div>
    </div>
  )
}


