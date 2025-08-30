import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L, { LatLngBounds } from 'leaflet'
import 'leaflet.markercluster'
import { fetchLatestForSite, fetchSevenDayTimeseriesReal, fetchSevenDayTimeseriesPredicted, fetchSitesByBBox } from '../api/usgs'
import { checkAnomaly, triggerTrainingBulk, getTrainModels, type TrainModelItem } from '../api/anomaly'
import { subscribeToAlerts, getRecentAlerts, type BackendAlert } from '../api/alerts'
import { Sparkline } from './Sparkline'
import { buttonStyle } from './buttonStyles'
import html2canvas from 'html2canvas'
import { createPdfReport } from '../api/report'
import type { TimePoint } from '../api/usgs'
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
  const [trainingStatus, setTrainingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [trainingMessage, setTrainingMessage] = useState<string>('')
  const [siteCooldownUntil, setSiteCooldownUntil] = useState<Record<string, number>>({})
  const COOLDOWN_MS = 10_000 // 30 seconds client-side cooldown
  const BULK_KEY = '*'
  const [tsByCode, setTsByCode] = useState<Record<string, TimePoint[]>>({})
  const [priorWeekTsByCode, setPriorWeekTsByCode] = useState<Record<string, TimePoint[]>>({})
  const [chartParam, setChartParam] = useState<'00060' | '00065' | '00010'>('00060')
  const [showActual, setShowActual] = useState(true)
  const [showPredicted, setShowPredicted] = useState(true)
  const [anomalyBySite, setAnomalyBySite] = useState<Record<string, boolean>>({})
  const [anomalyReasonBySite, setAnomalyReasonBySite] = useState<Record<string, string>>({})
  const [anomalyPredictedValueBySite, setAnomalyPredictedValueBySite] = useState<Record<string, number>>({})
  const [anomalyCurrentValueBySite, setAnomalyCurrentValueBySite] = useState<Record<string, number>>({})
  const hasAnomalies = useMemo(() => Object.values(anomalyBySite).some(Boolean), [anomalyBySite])
  const [recentAlerts, setRecentAlerts] = useState<BackendAlert[]>([])
  const [recentAlertsError, setRecentAlertsError] = useState<string | undefined>()
  const [recentAlertsLoading, setRecentAlertsLoading] = useState(false)
  const [alertsModalOpen, setAlertsModalOpen] = useState(false)
  const [alertsPage, setAlertsPage] = useState(1)
  const ALERTS_PER_PAGE = 5
  const refreshAlertsTimerRef = useRef<number | null>(null)
  const [activeTab, setActiveTab] = useState<'prediction' | 'alerts' | 'training'>('prediction')
  const [trainedItems, setTrainedItems] = useState<TrainModelItem[]>([])
  const [trainedLoading, setTrainedLoading] = useState(false)
  const [trainedError, setTrainedError] = useState<string | undefined>()

  // Focus San Jose, CA on first load
  const initialCenter = useMemo(() => ({ lat: 37.3382, lng: -121.8863 }), [])
  const initialZoom = 11
  const MAX_WIDTH_DEG = 1.0
  const MAX_HEIGHT_DEG = 1.0

  const sitesInView = useMemo(() => (needsZoom ? [] as UsgsSite[] : sites), [sites, needsZoom])
  const defaultIcon = useMemo(() => new L.Icon.Default(), [])
  const redDefaultIcon = useMemo(() => new L.Icon.Default({ className: 'leaflet-marker-icon marker-red' as any }), [])

  const isAnomalous = useCallback((siteNumber: string): boolean => {
    const candidates = [siteNumber, siteNumber.replace(/^0+/, '')]
    for (const c of candidates) {
      const key = String(c).trim()
      if (key && anomalyBySite[key]) return true
    }
    return false
  }, [anomalyBySite])

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
      const [latest, ts7, tsPrev] = await Promise.all([
        fetchLatestForSite(site.siteNumber),
        fetchSevenDayTimeseriesReal(site.siteNumber),
        fetchSevenDayTimeseriesPredicted(site.siteNumber),
      ])
      setSelected({ site, loading: false, latest })
      setTsByCode(ts7)
      // Shift prior week series forward by 7 days so it overlays current week
      const dayMs = 24 * 3600 * 1000
      const shifted: Record<string, TimePoint[]> = {}
      Object.keys(tsPrev).forEach((code) => {
        shifted[code] = (tsPrev[code] || []).map((p) => ({ timestampMs: p.timestampMs + 7 * dayMs, value: p.value }))
      })
      setPriorWeekTsByCode(shifted)
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

  // Load recent alerts initially and every 60s
  useEffect(() => {
    let timer: number | undefined
    const load = async () => {
      try {
        setRecentAlertsLoading(true)
        setRecentAlertsError(undefined)
        const { alerts } = await getRecentAlerts(1000)
        setRecentAlerts(alerts)
      } catch (e: any) {
        setRecentAlertsError(e?.message || 'Failed to load alerts')
      } finally {
        setRecentAlertsLoading(false)
      }
    }
    load()
    timer = window.setInterval(load, 60_000)
    return () => { if (timer) window.clearInterval(timer) }
  }, [])

  // Cleanup one-off refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshAlertsTimerRef.current) {
        window.clearTimeout(refreshAlertsTimerRef.current)
        refreshAlertsTimerRef.current = null
      }
    }
  }, [])

  // Load recent trained models when entering Training tab and every 60s while there
  useEffect(() => {
    if (activeTab !== 'training') return
    let timer: number | undefined
    const load = async () => {
      try {
        setTrainedLoading(true)
        setTrainedError(undefined)
        const { items } = await getTrainModels(10080)
        setTrainedItems(items)
      } catch (e: any) {
        setTrainedError(e?.message || 'Failed to load trained models')
      } finally {
        setTrainedLoading(false)
      }
    }
    load()
    timer = window.setInterval(load, 60_000)
    return () => { if (timer) window.clearInterval(timer) }
  }, [activeTab])

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
            crossOrigin
          />
          <BoundsWatcher onBoundsChange={loadSites} />
          {sites.map((s) => {
            const anomalous = isAnomalous(s.siteNumber)
            const markerKey = `${s.siteNumber}-${anomalous ? 'anom' : 'norm'}`
            return (
            <Marker
              key={markerKey}
              position={[s.location.latitude, s.location.longitude]}
              icon={anomalous ? redDefaultIcon : defaultIcon}
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
            )
          })}
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
      <aside style={{ borderLeft: '1px solid #e5e7eb', padding: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Tabs header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #e5e7eb', marginBottom: 8 }}>
          {[
            { key: 'prediction', label: 'Prediction' },
            { key: 'alerts', label: 'Alerts' },
            { key: 'training', label: 'Training' },
          ].map((t) => {
            const isActive = activeTab === (t.key as any)
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key as any)}
                style={{
                  ...buttonStyle({ variant: 'secondary', size: 'sm' }),
                  borderBottomColor: isActive ? '#ffffff' : '#e5e7eb',
                  borderRadius: '6px 6px 0 0',
                  background: isActive ? '#ffffff' : '#f9fafb',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        {activeTab === 'prediction' && (
        <div style={{ marginTop: 0, paddingTop: 0 }}>
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
          {/* moved buttons below chart */}
        </div>
        )}
        {activeTab === 'training' && (
        <div style={{ marginTop: 0, paddingTop: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Sites in view</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{sites.length}</div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: -4, marginBottom: 6 }}>Bulk‑train models for all visible sites.</div>
          <select
            onChange={(e) => {
              const sn = e.target.value
              const site = sitesInView.find((s) => s.siteNumber === sn)
              if (site) onSelectSite(site, true)
            }}
            style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#ffffff' }}
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
          <div style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                const stations = Array.from(new Set(sitesInView.map((s) => s.siteNumber)))
                if (stations.length === 0) return
                try {
                  setTrainingStatus('loading')
                  setTrainingMessage('')
                  await triggerTrainingBulk(stations)
                  setTrainingStatus('success')
                  setTrainingMessage(`Training triggered for ${stations.length} station(s). This may take a few minutes.`)
                } catch (e: any) {
                  setTrainingStatus('error')
                  setTrainingMessage(`Failed to trigger training${e?.message ? `: ${e.message}` : ''}`)
                }
              }}
              disabled={sitesInView.length === 0 || trainingStatus === 'loading'}
              aria-busy={trainingStatus === 'loading'}
              style={{ width: '100%', ...buttonStyle({ variant: 'primary', disabled: sitesInView.length === 0 || trainingStatus === 'loading' }) }}
            >
              {trainingStatus === 'loading' ? (
                <>
                  <span className="spinner-sm" aria-hidden />
                  Training…
                </>
              ) : (
                <>
                  Train Models
                </>
              )}
            </button>
            <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
              Will train models for {Array.from(new Set(sitesInView.map((s) => s.siteNumber))).length} station(s) in view.
            </div>
            {(trainingStatus === 'success' || trainingStatus === 'error') && (
              <div style={{ marginTop: 6, fontSize: 12, color: trainingStatus === 'success' ? '#065f46' : '#991b1b' }}>{trainingMessage}</div>
            )}
          </div>
          {/* Recent trained models */}
          <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb' }} />
          <div style={{ paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>Recent training (last 7 days)</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {trainedLoading && <span className="spinner-sm" aria-hidden />}
                <span style={{ fontSize: 12, color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 9999, padding: '2px 8px', background: '#f9fafb' }}>{trainedItems.length}</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setTrainedLoading(true)
                      setTrainedError(undefined)
                      const { items } = await getTrainModels(10080)
                      setTrainedItems(items)
                    } catch (e: any) {
                      setTrainedError(e?.message || 'Failed to load trained models')
                    } finally {
                      setTrainedLoading(false)
                    }
                  }}
                  style={{ fontSize: 12, ...buttonStyle({ variant: 'secondary', size: 'sm' }) }}
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
            {trainedError && <div style={{ fontSize: 12, color: '#991b1b' }}>{trainedError}</div>}
            {(!trainedItems || trainedItems.length === 0) && !trainedLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 0' }}>
                <img src="/desert.png" alt="No data" style={{ width: 200, height: 'auto', opacity: 0.9 }} />
                <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700, color: '#9ca3af' }}>No models</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {trainedItems.map((it) => (
                  <div key={it.uuid} style={{ border: '1px solid #e5e7eb', borderLeft: '4px solid #dbeafe', borderRadius: 8, padding: 10, background: '#ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                    <details>
                      <summary style={{ listStyle: 'none', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 8 }}>
                        <span className="arrow" aria-hidden style={{ color: '#6b7280' }}></span>
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            Execution ID: <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \\"Liberation Mono\\", \\"Courier New\\", monospace' }}>{it.uuid.slice(0, 29)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            Sites: {Array.isArray(it.sites) ? it.sites.length : 0} • {new Date(it.createdon).toLocaleString()}
                          </div>
                        </div>
                      </summary>
                      {Array.isArray(it.sites) && it.sites.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {it.sites.map((s) => (
                            <span key={s} style={{ fontSize: 12, border: '1px solid #dbeafe', color: '#1e40af', borderRadius: 9999, padding: '2px 8px', background: '#eef2ff' }}>#{s}</span>
                          ))}
                        </div>
                      )}
                    </details>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
        {/* <div style={{ overflow: 'auto', display: 'grid', gap: 6 }}></div> */}

        {activeTab === 'prediction' && (
        <div style={{ marginTop: 0, paddingTop: 0 }}>
          {!selected && (
            <div style={{ color: '#6b7280', margin: 0 }}>Select a site to see details, or view metrics below.</div>
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

          {/* Timeseries chart (single, selectable) */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Last 7 days</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="metric" value="00060" checked={chartParam === '00060'} onChange={() => setChartParam('00060')} />
                Discharge
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="metric" value="00065" checked={chartParam === '00065'} onChange={() => setChartParam('00065')} />
                Gage height
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="radio" name="metric" value="00010" checked={chartParam === '00010'} onChange={() => setChartParam('00010')} />
                Temperature
              </label>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  {chartParam === '00060' ? 'Discharge (ft³/s)' : chartParam === '00065' ? 'Gage height (ft)' : 'Temperature (°C)'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#374151' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
                    <span style={{ width: 20, height: 2, background: '#2563eb', display: 'inline-block' }}></span>
                    Real
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={showPredicted} onChange={(e) => setShowPredicted(e.target.checked)} />
                    <span style={{ width: 20, height: 2, background: '#dc2626', display: 'inline-block' }}></span>
                    Predicted
                  </label>
                </div>
              </div>
              <Sparkline points={tsByCode[chartParam] || []} predictedPoints={priorWeekTsByCode[chartParam] || []} width={800} height={260} showActual={showActual} showPredicted={showPredicted} />
            </div>
                          {/* Actions moved below chart */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    if (sites.length === 0) return
                    try {
                      setAnomalyMessage('')
                      const now = Date.now()
                      const until = siteCooldownUntil[BULK_KEY]
                      if (until && now < until) {
                        setAnomalyStatus('error')
                        const secs = Math.ceil((until - now) / 1000)
                        setAnomalyMessage(`Please wait ${secs}s before triggering again`)
                        return
                      }

                      setAnomalyStatus('loading')
                      const siteIds = Array.from(new Set(sites.map((s) => s.siteNumber)))
                      const resp = await checkAnomaly(siteIds)
                      setAnomalyStatus('success')
                      try {
                        const map: Record<string, boolean> = {}
                        const reasonMap: Record<string, string> = {}
                        const predictedMap: Record<string, number> = {}
                        const currentMap: Record<string, number> = {}
                        if (Array.isArray(resp?.results)) {
                          resp.results.forEach((r: any) => {
                            const id = String(r?.site || r?.station || r?.id || '').trim(); if (!id) return
                            map[id] = Boolean(r?.anomalous)
                            const reason = (r?.anomalous_reason ?? r?.reason ?? r?.message ?? '').toString().trim(); if (reason) reasonMap[id] = reason
                            const pv = (r?.predicted_value as any); const pvNum = typeof pv === 'number' ? pv : Number(pv); if (Number.isFinite(pvNum)) predictedMap[id] = pvNum
                            const cvRaw: any = (r?.current_value ?? r?.current ?? r?.value ?? r?.observed_value ?? r?.actual_value)
                            const cvNum = typeof cvRaw === 'number' ? cvRaw : Number(cvRaw); if (Number.isFinite(cvNum)) currentMap[id] = cvNum
                          })
                        } else if (Array.isArray(resp?.items)) {
                          resp.items.forEach((r: any) => {
                            const id = String(r?.site || r?.station || r?.id || '').trim(); if (!id) return
                            map[id] = Boolean(r?.anomalous)
                            const reason = (r?.anomalous_reason ?? r?.reason ?? r?.message ?? '').toString().trim(); if (reason) reasonMap[id] = reason
                            const pv = (r?.predicted_value as any); const pvNum = typeof pv === 'number' ? pv : Number(pv); if (Number.isFinite(pvNum)) predictedMap[id] = pvNum
                            const cvRaw: any = (r?.current_value ?? r?.current ?? r?.value ?? r?.observed_value ?? r?.actual_value)
                            const cvNum = typeof cvRaw === 'number' ? cvRaw : Number(cvRaw); if (Number.isFinite(cvNum)) currentMap[id] = cvNum
                          })
                        } else if (Array.isArray(resp)) {
                          resp.forEach((r: any) => {
                            const id = String(r?.site || r?.station || r?.id || '').trim(); if (!id) return
                            map[id] = Boolean(r?.anomalous)
                            const reason = (r?.anomalous_reason ?? r?.reason ?? r?.message ?? '').toString().trim(); if (reason) reasonMap[id] = reason
                            const pv = (r?.predicted_value as any); const pvNum = typeof pv === 'number' ? pv : Number(pv); if (Number.isFinite(pvNum)) predictedMap[id] = pvNum
                            const cvRaw: any = (r?.current_value ?? r?.current ?? r?.value ?? r?.observed_value ?? r?.actual_value)
                            const cvNum = typeof cvRaw === 'number' ? cvRaw : Number(cvRaw); if (Number.isFinite(cvNum)) currentMap[id] = cvNum
                          })
                        } else if (resp && typeof resp === 'object') {
                          Object.keys(resp).forEach((k) => {
                            const v: any = (resp as any)[k]
                            if (v && typeof v === 'object') {
                              if ('anomalous' in v) map[String(k).trim()] = Boolean((v as any).anomalous)
                              const reason = (v?.anomalous_reason ?? v?.reason ?? v?.message ?? '').toString().trim(); if (reason) reasonMap[String(k).trim()] = reason
                              const pv = (v?.predicted_value as any); const pvNum = typeof pv === 'number' ? pv : Number(pv); if (Number.isFinite(pvNum)) predictedMap[String(k).trim()] = pvNum
                              const cvRaw: any = (v?.current_value ?? v?.current ?? v?.value ?? v?.observed_value ?? v?.actual_value)
                              const cvNum = typeof cvRaw === 'number' ? cvRaw : Number(cvRaw); if (Number.isFinite(cvNum)) currentMap[String(k).trim()] = cvNum
                            } else if (typeof v === 'boolean') { map[k] = v }
                          })
                        }
                        if (Object.keys(map).length > 0) {
                          setAnomalyBySite(map)
                          setAnomalyReasonBySite(reasonMap)
                          setAnomalyPredictedValueBySite(predictedMap)
                          setAnomalyCurrentValueBySite(currentMap)
                          const flaggedIds = Object.keys(map).filter((k) => map[k])
                          const count = flaggedIds.length
                          const flaggedReasons = flaggedIds.map((id) => (reasonMap[id] || '').trim()).filter((r) => r.length > 0)
                          let reasonSuffix = ''
                          if (flaggedReasons.length > 0) {
                            const freq: Record<string, number> = {}
                            for (const r of flaggedReasons) freq[r] = (freq[r] || 0) + 1
                            const topReason = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
                            reasonSuffix = ` (reason: ${topReason})`
                          }
                          setAnomalyMessage(`Anomaly prediction triggered for ${siteIds.length} site(s); ${count} flagged${reasonSuffix}.`)

                          if (count > 0) {
                            try {
                              await new Promise((r) => setTimeout(r, 300))
                              const mapEl = document.querySelector('.leaflet-container') as HTMLElement
                              if (mapEl) {
                                const redSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='25' height='41' viewBox='0 0 25 41'><path d='M12.5 0C5.6 0 0 5.6 0 12.5c0 8.1 11.2 17.6 11.7 18 .5.4 1.1.4 1.6 0C13.8 30.1 25 20.6 25 12.5 25 5.6 19.4 0 12.5 0z' fill='#dc2626'/><circle cx='12.5' cy='12.5' r='5.5' fill='#ffffff'/></svg>`
                                const redDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(redSvg)}`
                                const canvas = await html2canvas(mapEl, { useCORS: true, scale: 1, logging: false, onclone: (clonedDoc: Document) => {
                                  const imgs = clonedDoc.querySelectorAll('.leaflet-marker-icon.marker-red') as NodeListOf<HTMLImageElement>
                                  imgs.forEach((img) => { try { img.src = redDataUrl } catch {} })
                                } } as any)
                                const dataUrl = canvas.toDataURL('image/png')
                                const today = new Date().toISOString().slice(0, 10)
                                const items = flaggedIds.map((id) => ({ site: id, reason: (reasonMap[id] || flaggedReasons[0] || '').toString() || undefined, predicted_value: (predictedMap[id] ?? null) as number | null, anomaly_date: today }))
                                await createPdfReport(dataUrl, items)
                              }
                            } catch (err) { console.warn('Failed to create report', err) }
                          }
                        } else { setAnomalyMessage(`Anomaly prediction triggered for ${siteIds.length} site(s)`) }
                      } catch { setAnomalyMessage(`Anomaly prediction triggered for ${siteIds.length} site(s)`) }
                      setSiteCooldownUntil({ ...siteCooldownUntil, [BULK_KEY]: now + COOLDOWN_MS })
                    } catch (e: any) {
                      setAnomalyStatus('error')
                      setAnomalyMessage(`Failed to trigger anomaly prediction${e?.message ? `: ${e.message}` : ''}`)
                    } finally {
                      try {
                        if (refreshAlertsTimerRef.current) window.clearTimeout(refreshAlertsTimerRef.current)
                        refreshAlertsTimerRef.current = window.setTimeout(async () => { try { const { alerts } = await getRecentAlerts(1000); setRecentAlerts(alerts) } catch {} }, 15000)
                      } catch {}
                    }
                  }}
                  disabled={sites.length === 0 || anomalyStatus === 'loading'}
                  aria-label="Predict anomaly for visible sites"
                  title="Predict anomaly for visible sites"
                  aria-busy={anomalyStatus === 'loading'}
                  style={{ width: '100%', ...buttonStyle({ variant: 'primary', disabled: sites.length === 0 || anomalyStatus === 'loading' }) }}
                >
                  {anomalyStatus === 'loading' ? 'Predicting…' : 'Predict Anomaly'}
                </button>
                <button
                  onClick={() => { setAnomalyBySite({}); setAnomalyReasonBySite({}); setAnomalyPredictedValueBySite({}); setAnomalyCurrentValueBySite({}); setAnomalyStatus('idle'); setAnomalyMessage('Anomalous markers reset') }}
                  disabled={!hasAnomalies}
                  aria-label="Reset anomaly markers"
                  title="Reset anomaly markers"
                  style={{ width: '100%', ...buttonStyle({ variant: hasAnomalies ? 'primary' : 'secondary', disabled: !hasAnomalies }) }}
                >
                  Reset
                </button>
              </div>
              {hasAnomalies && (() => {
                const flaggedAll = Object.keys(anomalyBySite).filter((id) => anomalyBySite[id])
                const selectedId = selected?.site?.siteNumber
                const flaggedSorted = flaggedAll.sort((a, b) => {
                  if (selectedId && a === selectedId) return -1
                  if (selectedId && b === selectedId) return 1
                  return a.localeCompare(b)
                })
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontWeight: 700 }}>Anomalous sites</div>
                      <span style={{ fontSize: 12, color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 9999, padding: '2px 8px', background: '#f9fafb' }}>{flaggedSorted.length}</span>
                    </div>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#ffffff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr minmax(78px, auto) minmax(78px, auto)', gap: 8, padding: '6px 8px', fontSize: 12, color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <div>Site</div>
                        <div>Reason</div>
                        <div style={{ textAlign: 'right' }}>Current</div>
                        <div style={{ textAlign: 'right' }}>Predicted</div>
                      </div>
                      <div style={{ maxHeight: 160, overflow: 'auto' }}>
                        {flaggedSorted.map((id) => {
                          const reason = anomalyReasonBySite[id]
                          const predicted = anomalyPredictedValueBySite[id]
                          const current = anomalyCurrentValueBySite[id]
                          const isSelected = selectedId === id
                          return (
                            <div key={id} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr minmax(78px, auto) minmax(78px, auto)', gap: 8, padding: '8px 8px', alignItems: 'center', borderBottom: '1px solid #f3f4f6', background: isSelected ? '#f8fafc' : undefined }}>
                              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', whiteSpace: 'nowrap' }}>#{id}</div>
                              <div title={reason || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reason || '—'}</div>
                              <div style={{ textAlign: 'right' }}>{Number.isFinite(current) ? String(current) : '—'}</div>
                              <div style={{ textAlign: 'right' }}>{Number.isFinite(predicted) ? String(predicted) : '—'}</div>
                            </div>
                          )
                        })}
                        {flaggedSorted.length === 0 && (
                          <div style={{ padding: 10, color: '#6b7280', fontSize: 12 }}>No anomalous sites</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
              {(anomalyStatus === 'success' || anomalyStatus === 'error') && (
                <div style={{ marginTop: 6, fontSize: 12, color: anomalyStatus === 'success' ? '#065f46' : '#991b1b' }}>{anomalyMessage}</div>
              )}
          </div>

          {/* Alerts moved to Alerts tab */}

          

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
        )}
        {/* Alerts tab content: alerts list + notifications */}
        {activeTab === 'alerts' && (
          <div>
            {/* Notifications first */}
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Notifications</div>
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
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 12 }}
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
                style={{ ...buttonStyle({ variant: 'primary', disabled: subscribeStatus === 'loading', size: 'sm' }) }}
              >
                Subscribe
              </button>
              {(subscribeStatus === 'success' || subscribeStatus === 'error') && (
                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: subscribeStatus === 'success' ? '#065f46' : '#991b1b' }}>
                  {subscribeMessage}
                </div>
              )}
            </form>

            {/* Alerts list second */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>Alerts (last 1 day)</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {recentAlertsLoading && <span className="spinner-sm" aria-hidden />}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setRecentAlertsLoading(true)
                      setRecentAlertsError(undefined)
                      const { alerts } = await getRecentAlerts(1000)
                      setRecentAlerts(alerts)
                    } catch (e: any) {
                      setRecentAlertsError(e?.message || 'Failed to load alerts')
                    } finally {
                      setRecentAlertsLoading(false)
                    }
                  }}
                  style={{ fontSize: 12, ...buttonStyle({ variant: 'secondary', size: 'sm' }) }}
                  aria-label="Refresh alerts"
                >
                  Refresh
                </button>
              </div>
            </div>
            {recentAlertsError && <div style={{ fontSize: 12, color: '#991b1b' }}>{recentAlertsError}</div>}

            {(!recentAlerts || recentAlerts.length === 0) && !recentAlertsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 0' }}>
                <img src="/desert.png" alt="No data" style={{ width: 280, height: 'auto', opacity: 0.9 }} />
                <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, color: '#9ca3af' }}>No Data</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recentAlerts.slice(0, 5).map((a) => {
                  const sev = (a.severity || '').toLowerCase()
                  const badgeColor = sev === 'high' ? '#dc2626' : sev === 'medium' ? '#d97706' : '#059669'
                  return (
                    <div key={a.alert_id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700 }}>{a.alert_name || 'Alert'}</span>
                          <span style={{ display: 'inline-block', fontSize: 12, color: '#fff', background: badgeColor, borderRadius: 9999, padding: '2px 8px' }}>{sev || 'info'}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {a.anomaly_date ? `Anomaly date: ${a.anomaly_date}` : ''}
                          {a.createdon_ms ? ` • ${new Date(a.createdon_ms).toLocaleString()}` : ''}
                        </div>
                        {Array.isArray(a.sites_impacted) && a.sites_impacted.length > 0 && (
                          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {a.sites_impacted.slice(0, 4).map((s) => (
                              <span key={s} style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 9999, padding: '2px 8px', background: '#f3f4f6' }}>#{s}</span>
                            ))}
                            {a.sites_impacted.length > 4 && (
                              <span style={{ fontSize: 12, color: '#6b7280' }}>+{a.sites_impacted.length - 4} more</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {a.s3_signed_url && (
                          <a href={a.s3_signed_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', fontSize: 14, background: '#1f2937', color: '#fff' }}>
                            Download report
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
                {recentAlerts.length > 5 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => { setAlertsModalOpen(true); setAlertsPage(1) }}
                      style={{ marginTop: 4, fontSize: 12, ...buttonStyle({ variant: 'secondary', size: 'sm' }) }}
                    >
                      View all {recentAlerts.length} alerts
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
      {anomalyStatus === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          aria-busy
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            pointerEvents: 'all',
          }}
        >
          <div className="spinner" aria-label="Loading" />
        </div>
      )}
      {alertsModalOpen && (
        <div
          role="dialog"
          aria-modal
          aria-label="All alerts"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000,
            display: 'grid', placeItems: 'center'
          }}
          onClick={() => setAlertsModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', width: 'min(900px, 96vw)', maxHeight: '90vh', borderRadius: 10, border: '1px solid #e5e7eb', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 700 }}>All Alerts (last 10 min)</div>
              <button type="button" onClick={() => setAlertsModalOpen(false)} style={{ ...buttonStyle({ variant: 'secondary', size: 'sm' }) }}>Close</button>
            </div>
            <div style={{ padding: 12, overflow: 'hidden' }}>
              {(() => {
                const total = recentAlerts.length
                const totalPages = Math.max(1, Math.ceil(total / ALERTS_PER_PAGE))
                const page = Math.min(alertsPage, totalPages)
                const start = (page - 1) * ALERTS_PER_PAGE
                const end = Math.min(start + ALERTS_PER_PAGE, total)
                const pageItems = recentAlerts.slice(start, end)
                return (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {pageItems.map((a) => {
                      const sev = (a.severity || '').toLowerCase()
                      const badgeColor = sev === 'high' ? '#dc2626' : sev === 'medium' ? '#d97706' : '#059669'
                      return (
                        <div key={a.alert_id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontWeight: 700 }}>{a.alert_name || 'Alert'}</span>
                              <span style={{ display: 'inline-block', fontSize: 12, color: '#fff', background: badgeColor, borderRadius: 9999, padding: '2px 8px' }}>{sev || 'info'}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#6b7280' }}>
                              {a.anomaly_date ? `Anomaly date: ${a.anomaly_date}` : ''}
                              {a.createdon_ms ? ` • ${new Date(a.createdon_ms).toLocaleString()}` : ''}
                            </div>
                            {Array.isArray(a.sites_impacted) && a.sites_impacted.length > 0 && (
                              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {a.sites_impacted.map((s) => (
                                  <span key={s} style={{ fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 9999, padding: '2px 8px', background: '#f3f4f6' }}>#{s}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {a.s3_signed_url && (
                              <a href={a.s3_signed_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', fontSize: 12, background: '#1f2937', color: '#fff' }}>
                                View report
                              </a>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {recentAlerts.length === 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                        <img src="/desert.png" alt="No data" style={{ width: 280, height: 'auto', opacity: 0.9 }} />
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, color: '#9ca3af' }}>No Data</div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Page {alertsPage} of {Math.max(1, Math.ceil(recentAlerts.length / ALERTS_PER_PAGE))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={alertsPage <= 1}
                  onClick={() => setAlertsPage((p) => Math.max(1, p - 1))}
                  style={{ ...buttonStyle({ variant: 'secondary', size: 'sm', disabled: alertsPage <= 1 }) }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={alertsPage >= Math.max(1, Math.ceil(recentAlerts.length / ALERTS_PER_PAGE))}
                  onClick={() => setAlertsPage((p) => Math.min(Math.max(1, Math.ceil(recentAlerts.length / ALERTS_PER_PAGE)), p + 1))}
                  style={{ ...buttonStyle({ variant: 'secondary', size: 'sm', disabled: alertsPage >= Math.max(1, Math.ceil(recentAlerts.length / ALERTS_PER_PAGE)) }) }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


