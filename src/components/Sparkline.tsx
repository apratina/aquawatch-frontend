import React from 'react'

type Props = {
  points: { timestampMs: number; value: number | null }[]
  /** Optional predicted series to overlay (drawn in red). */
  predictedPoints?: { timestampMs: number; value: number | null }[]
  /** internal drawing width in px (SVG scales to 100% width) */
  width?: number
  /** SVG height in px */
  height?: number
  stroke?: string
  /** whether to render the actual/real series */
  showActual?: boolean
  /** whether to render the predicted series */
  showPredicted?: boolean
}

// Sparkline with simple axes and labels.
export const Sparkline: React.FC<Props> = ({ points, predictedPoints = [], width = 800, height = 260, stroke = '#2563eb', showActual = true, showPredicted = true }) => {
  const [cursorX, setCursorX] = React.useState<number | null>(null)
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const filtered = points.filter((p) => typeof p.value === 'number') as { timestampMs: number; value: number }[]
  const filteredPred = predictedPoints.filter((p) => typeof p.value === 'number') as { timestampMs: number; value: number }[]
  if (filtered.length === 0 && filteredPred.length === 0) {
    return (
      <div style={{ height, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/desert.png" alt="No data" style={{ width: 280, height: 'auto', opacity: 0.9 }} />
        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, color: '#9ca3af' }}>No Data</div>
      </div>
    )
  }
  // Domains include both series
  const all = [...filtered, ...filteredPred]
  const xs = all.map((p) => p.timestampMs).sort((a, b) => a - b)
  const minX = xs[0]
  const maxX = xs[xs.length - 1]
  const ys = all.map((p) => p.value)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  // Layout
  // Increase X-axis height (bottom margin ~3x of original) and minimize right margin
  // Trim bottom whitespace while keeping labels readable
  const margin = { top: 8, right: 32, bottom: 54, left: 56 }
  const iw = Math.max(10, width - margin.left - margin.right)
  const ih = Math.max(10, height - margin.top - margin.bottom)

  const dx = maxX - minX || 1
  const dy = maxY - minY || 1
  const mapX = (t: number) => margin.left + ((t - minX) / dx) * iw
  // No extra padding so the line reaches the top/bottom of the chart area
  const mapY = (v: number) => margin.top + ih - ((v - minY) / dy) * ih

  const d = filtered.map((p) => `${mapX(p.timestampMs)},${mapY(p.value)}`).join(' ')
  const dPred = filteredPred.map((p) => `${mapX(p.timestampMs)},${mapY(p.value)}`).join(' ')

  // X ticks: 4 evenly spaced labels (start, 1/3, 2/3, end)
  const tickCount = 4
  const xTicks = Array.from({ length: tickCount }, (_, i) => minX + (i * dx) / (tickCount - 1))
  const fmtDate = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  // Y ticks: min and max (and mid if useful)
  const yTicks = dy > 0 ? [minY, (minY + maxY) / 2, maxY] : [minY]
  const fmtNum = (n: number) => {
    // compact but readable
    if (Math.abs(n) >= 1000) return `${Math.round(n).toLocaleString()}`
    return `${Number(n.toFixed(2))}`
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const rel = (e.clientX - rect.left) / rect.width
    const x = Math.max(0, Math.min(1, rel)) * width
    // Constrain to plotting area only
    const clamped = Math.max(margin.left, Math.min(margin.left + iw, x))
    setCursorX(clamped)
  }

  const handleMouseLeave = () => setCursorX(null)

  return (
    <svg
      ref={svgRef}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="7 day chart"
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'crosshair' }}
    >
      {/* Axes */}
      <line x1={margin.left} y1={margin.top + ih} x2={margin.left + iw} y2={margin.top + ih} stroke="#e5e7eb" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + ih} stroke="#e5e7eb" />

      {/* X ticks */}
      {xTicks.map((t, i) => (
        <g key={`x${i}`}> 
          <line x1={mapX(t)} y1={margin.top + ih} x2={mapX(t)} y2={margin.top + ih + 4} stroke="#9ca3af" />
          <text x={mapX(t)} y={margin.top + ih + 16} fontSize={12} fontWeight={700} textAnchor="middle" fill="#374151">{fmtDate(t)}</text>
        </g>
      ))}

      {/* Y ticks */}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={margin.left - 4} y1={mapY(v)} x2={margin.left} y2={mapY(v)} stroke="#9ca3af" />
          <text x={margin.left - 6} y={mapY(v) + 4} fontSize={12} fontWeight={700} textAnchor="end" fill="#374151">{fmtNum(v)}</text>
        </g>
      ))}

      {/* Lines */}
      {showActual && filtered.length > 0 && (
        <polyline fill="none" stroke={stroke} strokeWidth={2} points={d} />
      )}
      {showPredicted && filteredPred.length > 0 && (
        <polyline fill="none" stroke="#dc2626" strokeWidth={2} points={dPred} />
      )}
      {/* Hover crosshair line */}
      {cursorX !== null && (
        <line x1={cursorX} y1={margin.top} x2={cursorX} y2={margin.top + ih} stroke="#9ca3af" strokeDasharray="4 3" strokeWidth={1} pointerEvents="none" />
      )}

      {/* Tooltip with nearest values */}
      {cursorX !== null && (() => {
        // invert x back to time
        const tAtCursor = minX + ((cursorX - margin.left) / Math.max(1, iw)) * dx
        const nearest = (arr: { timestampMs: number; value: number }[]) => {
          if (!arr || arr.length === 0) return null as null | { t: number; v: number }
          let bestIdx = 0
          let bestDist = Math.abs(arr[0].timestampMs - tAtCursor)
          for (let i = 1; i < arr.length; i++) {
            const d = Math.abs(arr[i].timestampMs - tAtCursor)
            if (d < bestDist) { bestDist = d; bestIdx = i }
          }
          return { t: arr[bestIdx].timestampMs, v: arr[bestIdx].value }
        }
        const nReal = showActual ? nearest(filtered) : null
        const nPred = showPredicted ? nearest(filteredPred) : null

        const tx = (() => {
          const tooltipWidth = 120
          const preferred = cursorX + 10
          const maxXPos = margin.left + iw - tooltipWidth
          return Math.max(margin.left, Math.min(maxXPos, preferred))
        })()
        const ty = margin.top + 8
        const lineHeight = 14
        const lines = [
          `Date: ${fmtDate(tAtCursor)}`,
          nReal ? `Real: ${fmtNum(nReal.v)}` : undefined,
          nPred ? `Predicted: ${fmtNum(nPred.v)}` : undefined,
        ].filter(Boolean) as string[]
        const tooltipHeight = 10 + lines.length * (lineHeight + 4)

        return (
          <g pointerEvents="none">
            {/* highlight dots */}
            {nReal && (
              <circle cx={mapX(nReal.t)} cy={mapY(nReal.v)} r={3} fill={stroke} />
            )}
            {nPred && (
              <circle cx={mapX(nPred.t)} cy={mapY(nPred.v)} r={3} fill="#dc2626" />
            )}
            {/* tooltip card */}
            <rect x={tx} y={ty} width={120} height={tooltipHeight} rx={6} fill="rgba(59,130,246,0.18)" stroke="#60a5fa" />
            {lines.map((txt, i) => (
              <text key={i} x={tx + 8} y={ty + 10 + (i + 1) * (lineHeight)} fontSize={12} fontWeight={700} fill="#1f2937">{txt}</text>
            ))}
          </g>
        )
      })()}
    </svg>
  )
}


