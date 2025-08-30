export type ButtonVariant = 'primary' | 'secondary'
export type ButtonSize = 'sm' | 'md'

export function buttonStyle({ variant = 'primary', disabled = false, size = 'md' }: { variant?: ButtonVariant; disabled?: boolean; size?: ButtonSize }) {
  const padding = size === 'sm' ? '6px 10px' : '10px 12px'
  const borderRadius = 8
  const base: any = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontWeight: 700,
    borderRadius,
    padding,
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    userSelect: 'none',
  }

  if (variant === 'primary') {
    if (disabled) {
      return {
        ...base,
        border: '1px solid #e5e7eb',
        background: '#f3f4f6',
        color: '#9ca3af',
        boxShadow: 'none',
      }
    }
    return {
      ...base,
      border: '1px solid #1f2937',
      background: 'linear-gradient(90deg, #1f2937, #111827)',
      color: '#ffffff',
      boxShadow: '0 6px 14px rgba(2,6,23,0.25)',
    }
  }

  // secondary
  if (disabled) {
    return {
      ...base,
      border: '1px solid #e5e7eb',
      background: '#f9fafb',
      color: '#9ca3af',
      boxShadow: 'none',
    }
  }
  return {
    ...base,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  }
}


