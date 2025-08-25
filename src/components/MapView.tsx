import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L, { LatLngBounds } from 'leaflet'
import 'leaflet.markercluster'
import { fetchLatestForSite, fetchSitesByBBox } from '../api/usgs'
import { triggerAnomaly, getPredictionStatus } from '../api/anomaly'
import { subscribeToAlerts } from '../api/alerts'
import type { UsgsSite } from '../api/usgs'

// Fix default marker icons for Leaflet in bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
})

type Selected = { site: UsgsSite; loading: boolean; error?: string; latest?: Awaited<ReturnType<typeof fetchLatestForSite>> }

function BoundsWatcher({ onBoundsChange }: { onBoundsChange: (b: LatLngBounds) => void }) {
  useMapEvents({
    load(e) {
      const map = e.target
      onBoundsChange(map.getBounds())
    },
    moveend(e) {
      const map = e.target
      onBoundsChange(map.getBounds())
    },
    zoomend(e) {
      const map = e.target
      onBoundsChange(map.getBounds())
    },
  })
  return null
}

// Interactive map view: fetches and displays USGS sites within bounds,
// shows marker popups, and a right panel with selection and latest values.
export function MapView() {
  const [sites, setSites] = useState<UsgsSite[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<Selected | undefined>()
  const lastFetchKey = useRef<string>('')
  const mapRef = useRef<L.Map | null>(null)
  const markerRefs = useRef<Record<string, L.Marker>>({})
  // No search box; use a simple dropdown instead
  const [needsZoom, setNeedsZoom] = useState(false)
  const [zoomHint, setZoomHint] = useState<string>('')
  const [emailInput, setEmailInput] = useState('')
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [subscribeMessage, setSubscribeMessage] = useState<string>('')
  const [anomalyStatus, setAnomalyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [anomalyMessage, setAnomalyMessage] = useState<string>('')
  const [siteCooldownUntil, setSiteCooldownUntil] = useState<Record<string, number>>({})
  const COOLDOWN_MS = 60_000 // 1 minute client-side cooldown

  // Focus San Jose, CA on first load
  const initialCenter = useMemo(() => ({ lat: 37.3382, lng: -121.8863 }), [])
  const initialZoom = 11
  const MAX_WIDTH_DEG = 1.0
  const MAX_HEIGHT_DEG = 1.0

  const sitesInView = useMemo(() => (needsZoom ? [] as UsgsSite[] : sites), [sites, needsZoom])

  // Fetch sites for the current map bounds
  const loadSites = useCallback(async (bounds: LatLngBounds) => {
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    const widthDeg = Math.abs(ne.lng - sw.lng)
    const heightDeg = Math.abs(ne.lat - sw.lat)
    const mustZoom = widthDeg > MAX_WIDTH_DEG || heightDeg > MAX_HEIGHT_DEG
    setNeedsZoom(mustZoom)
    setZoomHint(`width ${widthDeg.toFixed(2)}°, height ${heightDeg.toFixed(2)}° — need ≤ ${MAX_WIDTH_DEG}° × ≤ ${MAX_HEIGHT_DEG}°`)
    if (mustZoom) {
      setSites([])
      return
    }
    const key = `${sw.lng.toFixed(3)},${sw.lat.toFixed(3)}_${ne.lng.toFixed(3)},${ne.lat.toFixed(3)}`
    if (lastFetchKey.current === key) return
    lastFetchKey.current = key
    setLoading(true)
    setError(undefined)
    try {
      const res = await fetchSitesByBBox(sw.lng, sw.lat, ne.lng, ne.lat, { siteStatus: 'all' })
      setSites(res)
    } catch (e: any) {
      setError(e?.message || 'Failed to load sites')
    } finally {
      setLoading(false)
    }
  }, [])

  // Select a site: optionally pan, open popup if available, then fetch latest values
  const onSelectSite = useCallback(async (site: UsgsSite, pan: boolean = false) => {
    if (pan && mapRef.current) {
      const zoom = Math.max(mapRef.current.getZoom(), 12)
      mapRef.current.flyTo([site.location.latitude, site.location.longitude], zoom, { duration: 0.75 })
    }
    // Open the site's marker popup
    const marker = markerRefs.current[site.siteNumber]
    if (marker) {
      try { marker.openPopup() } catch {}
    }
    setSelected({ site, loading: true })
    try {
      const latest = await fetchLatestForSite(site.siteNumber)
      setSelected({ site, loading: false, latest })
    } catch (e: any) {
      setSelected({ site, loading: false, error: e?.message || 'Failed to load latest values' })
    }
  }, [])

  // Trigger an initial sites load on first mount using current bounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      loadSites(map.getBounds())
    } catch {}
  }, [loadSites])

  return (
    <div style={{ height: '100%', width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 3fr)', gap: 0 }}>
      {/* Map */}
      <div style={{ position: 'relative' }}>
        <MapContainer
          style={{ height: '100%', width: '100%' }}
          center={initialCenter}
          zoom={initialZoom}
          preferCanvas
          ref={mapRef as any}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <BoundsWatcher onBoundsChange={loadSites} />
          {sites.map((s) => (
            <Marker
              key={s.siteNumber}
              position={[s.location.latitude, s.location.longitude]}
              eventHandlers={{ click: () => onSelectSite(s) }}
              ref={(instance) => { if (instance) markerRefs.current[s.siteNumber] = instance }}
            >
              <Popup>
                <div className="popup-card" style={{ minWidth: 280, position: 'relative' }}>
                  <div style={{
                    position: 'absolute', top: -8, left: 0, right: 0, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                    padding: '0 14px', color: '#ffffff', fontWeight: 700,
                    pointerEvents: 'none'
                  }}>
                    Site Information
                  </div>
                  <div style={{ height: 36 }} />
                  <div style={{ margin: '10px 14px 4px 14px' }}>
                    <span style={{ fontWeight: 700 }}>Site Number:</span> {s.siteNumber}
                  </div>
                  <div style={{ margin: '0 14px 4px 14px' }}>
                    <span style={{ fontWeight: 700 }}>Site Name:</span> {s.name}
                  </div>
                  <div style={{ margin: '0 14px 4px 14px' }}>
                    <span style={{ fontWeight: 700 }}>Site Type:</span> {s.siteType || '—'}
                  </div>
                  <div style={{ margin: '0 14px 8px 14px' }}>
                    <span style={{ fontWeight: 700 }}>Agency:</span> {s.agencyCode}
                  </div>
                  <a
                    href={`https://waterdata.usgs.gov/monitoring-location/${s.siteNumber}`}
                    target="_blank" rel="noreferrer"
                    style={{ textDecoration: 'underline', display: 'inline-block', margin: '0 14px 10px 14px' }}
                  >
                    Access Data
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {loading && (
          <div style={{ position: 'absolute', top: 8, left: 8, background: 'white', padding: '6px 10px', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
            Loading sites…
          </div>
        )}
        {needsZoom && !loading && (
          <div style={{ position: 'absolute', top: 8, left: 8, background: 'white', padding: '6px 10px', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
            Zoom in to load sites (limit: ≤ {MAX_WIDTH_DEG}° width and ≤ {MAX_HEIGHT_DEG}° height).<br/>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{zoomHint}</span>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: '#fee2e2', color: '#991b1b', padding: '6px 10px', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
            {error}
          </div>
        )}
      </div>
      <aside style={{ borderLeft: '1px solid #e5e7eb', padding: 8, overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Sites in view</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{sites.length}</div>
          </div>
          <select
            onChange={(e) => {
              const sn = e.target.value
              const site = sitesInView.find((s) => s.siteNumber === sn)
              if (site) onSelectSite(site, true)
            }}
            style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px' }}
            value={selected?.site.siteNumber ?? ''}
            disabled={needsZoom || sitesInView.length === 0}
          >
            <option value="" disabled>
              {needsZoom ? 'Zoom in to load sites' : sitesInView.length > 0 ? 'Select a site…' : 'No sites in view'}
            </option>
            {sitesInView.map((s) => (
              <option key={s.siteNumber} value={s.siteNumber}>
                #{s.siteNumber} · {s.name}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (!selected) return
              try {
                setAnomalyMessage('')
                const siteId = selected.site.siteNumber
                const now = Date.now()
                const until = siteCooldownUntil[siteId]
                if (until && now < until) {
                  setAnomalyStatus('error')
                  const secs = Math.ceil((until - now) / 1000)
                  setAnomalyMessage(`Please wait ${secs}s before triggering again`)
                  return
                }

                // Ask backend for current status to avoid duplicate runs
                const status = await getPredictionStatus(siteId)
                if (status.inProgress) {
                  setAnomalyStatus('error')
                  setAnomalyMessage('Prediction was run recently for this site. Please retry after few minutes')
                  // Optional: set a short cooldown to avoid spamming
                  setSiteCooldownUntil({ ...siteCooldownUntil, [siteId]: now + 30_000 })
                  return
                }

                setAnomalyStatus('loading')
                await triggerAnomaly(siteId)
                setAnomalyStatus('success')
                setAnomalyMessage('Anomaly prediction triggered successfully')
                setSiteCooldownUntil({ ...siteCooldownUntil, [siteId]: now + COOLDOWN_MS })
              } catch (e: any) {
                setAnomalyStatus('error')
                setAnomalyMessage(`Failed to trigger anomaly prediction${e?.message ? `: ${e.message}` : ''}`)
              }
            }}
            disabled={!selected || anomalyStatus === 'loading'}
            aria-label="Predict anomaly for selected site"
            title="Predict anomaly for selected site"
            style={{ marginTop: 8, width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', background: selected ? '#1f2937' : '#f3f4f6', color: selected ? '#ffffff' : '#9ca3af', cursor: selected ? 'pointer' : 'not-allowed' }}
          >
            Predict Anomaly
          </button>
          {(anomalyStatus === 'success' || anomalyStatus === 'error') && (
            <div style={{ marginTop: 6, fontSize: 12, color: anomalyStatus === 'success' ? '#065f46' : '#991b1b' }}>{anomalyMessage}</div>
          )}
        </div>
        {/* <div style={{ overflow: 'auto', display: 'grid', gap: 6 }}></div> */}

        <div>
          {!selected && (
            <div style={{ color: '#6b7280', marginBottom: 8 }}>Select a site to see details, or view metrics below.</div>
          )}

          {selected?.loading && <div>Loading latest values…</div>}
          {selected?.error && <div style={{ color: '#991b1b' }}>{selected.error}</div>}

          {(() => {
            const latestList = selected?.latest || []
            const byCode: Record<string, typeof latestList[number]> = {}
            for (const p of latestList) byCode[p.parameterCode] = p
            const tiles = [
              { code: '00060', label: 'Discharge', fallbackUnit: 'ft³/s' },
              { code: '00065', label: 'Gage height', fallbackUnit: 'ft' },
              { code: '00010', label: 'Temperature', fallbackUnit: '°C' },
            ]
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {tiles.map((t) => {
                  const p = byCode[t.code]
                  const unit = t.code === '00060' ? 'ft³/s' : t.code === '00010' ? '°C' : (p?.unit || t.fallbackUnit)
                  const value = p && p.value !== null ? `${p.value} ${unit}` : 'N/A'
                  const ts = p?.observedAt
                  return (
                    <div key={t.code} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 20 }}>{value}</div>
                      {ts && <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(ts).toLocaleString()}</div>}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Notifications title and subscribe form */}
          <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb' }} />
          <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 6 }}>Notifications</div>
          <form
              onSubmit={async (e) => {
                e.preventDefault()
                const email = emailInput.trim()
                const valid = /.+@.+\..+/.test(email)
                if (!valid) {
                  setSubscribeStatus('error')
                  setSubscribeMessage('Enter a valid email address')
                  return
                }
                try {
                  setSubscribeStatus('loading')
                  setSubscribeMessage('')
                  await subscribeToAlerts(email)
                  localStorage.setItem('aquawatch_alert_email', email)
                  setSubscribeStatus('success')
                  setSubscribeMessage(
                    (selected ? 'Subscribed to alerts for this site. ' : 'Subscribed to alerts. ') +
                    'Please check your inbox and confirm the SNS subscription to start receiving alert notifications.'
                  )
                } catch (err: any) {
                  setSubscribeStatus('error')
                  setSubscribeMessage(`Subscription failed${err?.message ? `: ${err.message}` : ''}`)
                }
              }}
              style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}
              aria-label="Subscribe to alert notifications"
            >
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px' }}
              />
              <button
                type="submit"
                disabled={subscribeStatus === 'loading'}
                style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', background: '#1f2937', color: '#fff', cursor: 'pointer' }}
              >
                Subscribe
              </button>
              {(subscribeStatus === 'success' || subscribeStatus === 'error') && (
                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: subscribeStatus === 'success' ? '#065f46' : '#991b1b' }}>
                  {subscribeMessage}
                </div>
              )}
            </form>

          {/* {(() => {
            // Basic heuristic alerts from latest parameters (or none if not selected)
            const latestList = selected?.latest || []
            const byCode: Record<string, typeof latestList[number]> = {}
            for (const p of latestList) byCode[p.parameterCode] = p
            const alerts: string[] = []
            const discharge = byCode['00060']?.value
            const stage = byCode['00065']?.value
            const temp = byCode['00010']?.value
            if (typeof discharge === 'number' && discharge > 5000) alerts.push('High discharge detected')
            if (typeof stage === 'number' && stage > 10) alerts.push('High gage height (possible flooding)')
            if (typeof temp === 'number' && temp <= 0) alerts.push('Water temperature at or below freezing')

            return (
              <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Alerts</div>
                {alerts.length === 0 ? (
                  <div style={{ color: '#6b7280' }}>No active alerts.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {alerts.map((a, idx) => (
                      <li key={idx}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })()} */}

          
        </div>
      </aside>
    </div>
  )
}


