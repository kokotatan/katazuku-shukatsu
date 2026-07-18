export const INBOX_KEY = 'katazuku-inbox/emails'
export const PIPELINE_KEY = 'katazuku-pipeline/companies'

/** localStorage を JSON.parse。壊れたデータは空配列扱い(Inbox/Pipeline と同じ考え方) */
export function loadJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw) as T[]
  } catch {
    // 壊れたデータは空扱い
  }
  return []
}
