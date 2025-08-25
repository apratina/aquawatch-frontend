import axios from 'axios'

const BASE_URL = 'http://localhost:8080'

// Triggers backend ingestion/anomaly prediction for a given USGS station id.
export async function triggerAnomaly(stationId: string): Promise<void> {
  try {
    await axios.get(`${BASE_URL}/ingest`, { params: { station: stationId } })
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Trigger failed'
    throw new Error(message)
  }
}

export type PredictionStatus = {
  site: string
  inProgress: boolean
  status?: string
  createdOnMs?: number
  updatedOnMs?: number
}

// Query prediction status for a station. Maps snake_case to camelCase.
export async function getPredictionStatus(stationId: string): Promise<PredictionStatus> {
  const { data } = await axios.get(`${BASE_URL}/prediction/status`, { params: { site: stationId } })
  return {
    site: String(data?.site ?? stationId),
    inProgress: Boolean(data?.in_progress),
    status: data?.status,
    createdOnMs: typeof data?.createdon_ms === 'number' ? data.createdon_ms : undefined,
    updatedOnMs: typeof data?.updatedon_ms === 'number' ? data.updatedon_ms : undefined,
  }
}

// New API: check anomaly via POST with sites and threshold_percent
export async function checkAnomaly(sites: string[], thresholdPercent: number): Promise<any> {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/anomaly/check`,
      { sites, threshold_percent: thresholdPercent },
      { headers: { 'Content-Type': 'application/json' } }
    )
    return data
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Anomaly check failed'
    throw new Error(message)
  }
}


