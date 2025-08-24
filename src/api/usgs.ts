import axios from 'axios'

/**
 * USGS NWIS client helpers
 *
 * Exposes small utilities to fetch:
 * - Monitoring locations ("sites") within a bbox (tiled ≤1° to satisfy server limits)
 * - A single site by site number
 * - Latest instantaneous values (IV) for select parameters at a site
 *
 * Endpoints used:
 * - Site Service (RDB/tab-delimited): https://waterservices.usgs.gov/nwis/site/
 * - IV Service (JSON WaterML): https://waterservices.usgs.gov/nwis/iv/
 */

export type LatLng = {
  latitude: number
  longitude: number
}

export type UsgsSite = {
  siteNumber: string
  name: string
  agencyCode: string
  agencyName?: string
  location: LatLng
  siteType?: string
  state?: string
  county?: string
  hucCd?: string
  altitudeFt?: number
  altitudeDatum?: string
}

export type LatestParameter = {
  parameterCode: string
  description: string
  unit: string
  value: number | null
  observedAt?: string
}

// Legacy but stable NWIS endpoints: https://waterservices.usgs.gov
const NWIS_BASE = 'https://waterservices.usgs.gov/nwis'

function formatCoord(value: number): string {
  // Ensure no more than 7 decimal places per bbox value
  return value.toFixed(7)
}

/**
 * Fetch sites within a geographic bbox by tiling into ≤1° squares and merging
 * the results to avoid NWIS bbox size constraints.
 */
export async function fetchSitesByBBox(
  minLongitude: number,
  minLatitude: number,
  maxLongitude: number,
  maxLatitude: number,
  opts?: { siteStatus?: 'all' | 'active' | 'inactive'; parameterCodes?: string[] }
): Promise<UsgsSite[]> {
  // Tile into <=1 degree squares to satisfy NWIS bbox constraints
  const west = Math.min(minLongitude, maxLongitude)
  const east = Math.max(minLongitude, maxLongitude)
  const south = Math.min(minLatitude, maxLatitude)
  const north = Math.max(minLatitude, maxLatitude)

  const lonSteps: number[] = []
  for (let x = Math.floor(west); x < Math.ceil(east); x += 1) lonSteps.push(x)
  const latSteps: number[] = []
  for (let y = Math.floor(south); y < Math.ceil(north); y += 1) latSteps.push(y)

  const queries: Array<Promise<string>> = []
  for (const x of lonSteps) {
    for (const y of latSteps) {
      const tileWest = Math.max(west, x)
      const tileEast = Math.min(east, x + 1)
      const tileSouth = Math.max(south, y)
      const tileNorth = Math.min(north, y + 1)
      if (tileEast <= tileWest || tileNorth <= tileSouth) continue
      const params = new URLSearchParams()
      params.set(
        'bBox',
        `${formatCoord(tileWest)},${formatCoord(tileSouth)},${formatCoord(tileEast)},${formatCoord(tileNorth)}`
      )
      params.set('format', 'rdb')
      params.set('hasDataTypeCd', 'iv')
      if (opts?.siteStatus) params.set('siteStatus', opts.siteStatus)
      const url = `${NWIS_BASE}/site/?${params.toString()}`
      queries.push(
        axios.get(url, { responseType: 'text' }).then((r) => String(r.data)).catch(() => '')
      )
    }
  }

  const texts = await Promise.all(queries)
  const uniqueByNumber = new Map<string, UsgsSite>()

  for (const text of texts) {
    if (!text) continue
    const lines = text.split(/\r?\n/)
    // Find header line (tab-separated with known fields)
    const headerIndex = lines.findIndex((l) => l.startsWith('agency_cd'))
    if (headerIndex === -1) continue
    const header = lines[headerIndex].split(/\t/)
    const idx = {
      agency_cd: header.indexOf('agency_cd'),
      site_no: header.indexOf('site_no'),
      station_nm: header.indexOf('station_nm'),
      site_tp_cd: header.indexOf('site_tp_cd'),
      dec_lat_va: header.indexOf('dec_lat_va'),
      dec_long_va: header.indexOf('dec_long_va'),
      state_cd: header.indexOf('state_cd'),
      county_cd: header.indexOf('county_cd'),
      huc_cd: header.indexOf('huc_cd'),
      alt_va: header.indexOf('alt_va'),
      alt_datum_cd: header.indexOf('alt_datum_cd'),
    }
    for (let i = headerIndex + 2; i < lines.length; i++) {
      const row = lines[i]
      if (!row || row.startsWith('#')) continue
      const cols = row.split(/\t/)
      const siteNumber = cols[idx.site_no]
      const name = cols[idx.station_nm]
      const agencyCode = cols[idx.agency_cd]
      const lat = Number(cols[idx.dec_lat_va])
      const lon = Number(cols[idx.dec_long_va])
      if (!siteNumber || Number.isNaN(lat) || Number.isNaN(lon)) continue
      const altitudeFt = idx.alt_va >= 0 ? Number(cols[idx.alt_va]) : NaN
      uniqueByNumber.set(siteNumber, {
        siteNumber,
        name,
        agencyCode,
        location: { latitude: lat, longitude: lon },
        siteType: idx.site_tp_cd >= 0 ? cols[idx.site_tp_cd] : undefined,
        state: idx.state_cd >= 0 ? cols[idx.state_cd] : undefined,
        county: idx.county_cd >= 0 ? cols[idx.county_cd] : undefined,
        hucCd: idx.huc_cd >= 0 ? cols[idx.huc_cd] : undefined,
        altitudeFt: Number.isFinite(altitudeFt) ? altitudeFt : undefined,
        altitudeDatum: idx.alt_datum_cd >= 0 ? cols[idx.alt_datum_cd] : undefined,
      })
    }
  }

  return Array.from(uniqueByNumber.values())
}

export async function fetchSiteByNumber(siteNumber: string): Promise<UsgsSite | null> {
  // Query a single site via RDB; project to UsgsSite
  const params = new URLSearchParams()
  params.set('sites', siteNumber)
  params.set('format', 'rdb')
  params.set('hasDataTypeCd', 'iv')
  const url = `${NWIS_BASE}/site/?${params.toString()}`
  const text = String((await axios.get(url, { responseType: 'text' })).data || '')
  const lines = text.split(/\r?\n/)
  const headerIndex = lines.findIndex((l) => l.startsWith('agency_cd'))
  if (headerIndex === -1) return null
  const header = lines[headerIndex].split(/\t/)
  const idx = {
    agency_cd: header.indexOf('agency_cd'),
    site_no: header.indexOf('site_no'),
    station_nm: header.indexOf('station_nm'),
    site_tp_cd: header.indexOf('site_tp_cd'),
    dec_lat_va: header.indexOf('dec_lat_va'),
    dec_long_va: header.indexOf('dec_long_va'),
    state_cd: header.indexOf('state_cd'),
    county_cd: header.indexOf('county_cd'),
    huc_cd: header.indexOf('huc_cd'),
    alt_va: header.indexOf('alt_va'),
    alt_datum_cd: header.indexOf('alt_datum_cd'),
  }
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const row = lines[i]
    if (!row || row.startsWith('#')) continue
    const cols = row.split(/\t/)
    const sn = cols[idx.site_no]
    const name = cols[idx.station_nm]
    const agencyCode = cols[idx.agency_cd]
    const lat = Number(cols[idx.dec_lat_va])
    const lon = Number(cols[idx.dec_long_va])
    if (!sn || Number.isNaN(lat) || Number.isNaN(lon)) continue
    const altitudeFt = idx.alt_va >= 0 ? Number(cols[idx.alt_va]) : NaN
    return {
      siteNumber: sn,
      name,
      agencyCode,
      location: { latitude: lat, longitude: lon },
      siteType: idx.site_tp_cd >= 0 ? cols[idx.site_tp_cd] : undefined,
      state: idx.state_cd >= 0 ? cols[idx.state_cd] : undefined,
      county: idx.county_cd >= 0 ? cols[idx.county_cd] : undefined,
      hucCd: idx.huc_cd >= 0 ? cols[idx.huc_cd] : undefined,
      altitudeFt: Number.isFinite(altitudeFt) ? altitudeFt : undefined,
      altitudeDatum: idx.alt_datum_cd >= 0 ? cols[idx.alt_datum_cd] : undefined,
    }
  }
  return null
}

export async function fetchLatestForSite(
  siteNumber: string,
  parameterCodes: string[] = ['00060', '00065', '00010']
): Promise<LatestParameter[]> {
  // IV endpoint returns JSON WaterML timeSeries with latest values
  const params = new URLSearchParams()
  params.set('format', 'json')
  params.set('sites', siteNumber)
  params.set('parameterCd', parameterCodes.join(','))
  params.set('siteStatus', 'all')

  const url = `${NWIS_BASE}/iv/?${params.toString()}`
  const { data } = await axios.get(url)
  const series: any[] = data?.value?.timeSeries || []

  const latest: LatestParameter[] = series.map((s) => {
    const variable = s?.variable
    const variableCode = variable?.variableCode?.[0]?.value
    const unit = variable?.unit?.unitCode
    const description = variable?.variableDescription || variableCode
    const points: any[] = s?.values?.[0]?.value || []
    const last = points[points.length - 1]
    const value = last ? Number(last?.value) : null
    const observedAt = last?.dateTime
    return {
      parameterCode: String(variableCode || ''),
      description: String(description || ''),
      unit: String(unit || ''),
      value: Number.isFinite(value) ? (value as number) : null,
      observedAt,
    }
  })

  return latest
}


