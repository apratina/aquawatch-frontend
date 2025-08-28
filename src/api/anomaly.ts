import { http } from './http'

// Triggers backend ingestion/anomaly prediction for a given USGS station id.
export async function triggerAnomaly(stationId: string): Promise<void> {
  try {
    await http.get(`/ingest`, { params: { station: stationId } })
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Trigger failed'
    throw new Error(message)
  }
}

// Trigger training for a given station (ingest with train=true)
export async function triggerTraining(stationId: string): Promise<void> {
  try {
    await http.get(`/ingest`, { params: { station: stationId, train: true } })
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Training trigger failed'
    throw new Error(message)
  }
}

// Trigger training for multiple stations (?station=... repeated) with train=true
export async function triggerTrainingBulk(stations: string[]): Promise<void> {
  if (!stations || stations.length === 0) return
  try {
    const params = new URLSearchParams()
    stations.forEach((s) => params.append('station', s))
    params.append('train', 'true')
    await http.get(`/ingest?${params.toString()}`)
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Training trigger failed'
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
  const { data } = await http.get(`/prediction/status`, { params: { site: stationId } })
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
    const { data } = await http.post(
      `/anomaly/check`,
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

export type TrainModelItem = {
  uuid: string
  createdon: number
  sites: string[]
}

export async function getTrainModels(minutes: number = 10080): Promise<{ items: TrainModelItem[]; since_ms?: number }> {
  try {
    const { data } = await http.get(`/train/models`, { params: { minutes } })
    const items: TrainModelItem[] = Array.isArray(data?.items) ? data.items : []
    return { items, since_ms: typeof data?.since_ms === 'number' ? data.since_ms : undefined }
  } catch (err: any) {
    const data = err?.response?.data
    const apiMessage = (data && (data.error || data.message)) || (typeof data === 'string' ? data : null)
    const message = apiMessage || err?.message || 'Failed to load training models'
    throw new Error(message)
  }
}


