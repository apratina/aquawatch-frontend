import { http } from './http'

export type ReportItem = {
  site: string
  reason?: string
  predicted_value?: number | null
  anomaly_date?: string
}

export async function createPdfReport(imageBase64: string, items: ReportItem[]): Promise<void> {
  await http.post('/report/pdf', { image_base64: imageBase64, items }, { headers: { 'Content-Type': 'application/json' } })
}


