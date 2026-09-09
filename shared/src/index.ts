export interface Selection {
  id: number
  companyId: number
  company: string
  season: string
  position: string
  priority: string
  status: string
  outcome: string
  steps: string[]
  nextAction: string
  nextDate: string
  submitted: boolean
  esUrl: string
  memo: string
}

export interface Appointment {
  id: number
  selectionId: number
  company: string
  at: string
  endAt: string
  kind: string
  title: string
  url: string
  location: string
  person: string
  status: string
}

export interface MailItem {
  id: string
  selectionId?: number
  receivedAt: string
  sender: string
  subject: string
  summary: string
  category: string
  needsAction: number | boolean
  deadline: string
  status: string
  sourceRef: string
  company?: string
}

export interface Person {
  id: number
  name: string
  company: string
  officialCompany?: string
  role: string
  category: string
  metAt: string
  howMet: string
  followUp: string
  updatedAt: string
  photoKey?: string
}

export interface PersonNote {
  id: number
  personId: number
  personName: string
  at: string
  note: string
  sourceRef: string
  confidence: number
}

export interface Dossier {
  companyId: number
  company: string
  summary: string
  facts: Record<string, unknown>
  sources: { title?: string; url?: string; retrievedAt?: string }[]
  researchedAt: string
  sourceRef: string
}

export interface MeetingPreparation {
  appointmentId: number
  companyId: number
  company: string
  at: string
  title: string
  status: 'ready' | 'pending'
  reasons: string[]
  preparedAt?: string
  summary?: string
  counterpartResearch?: string
  priorContext?: string
  questionsToAsk?: string[]
  anticipatedQuestions?: { question: string; answerOutline: string }[]
  sources?: { title: string; url: string }[]
  unknowns?: string[]
}

export interface Interview {
  id: number
  appointmentId?: number
  selectionId: number
  occurredAt: string
  title: string
  summary: string
  sourceRef: string
  company: string
  detail: Record<string, unknown>
}

export interface Activity {
  ts?: string
  by?: string
  action?: string
  link?: string
  result?: string
  at?: string
  what?: string
  why?: string
  how?: string
  [key: string]: unknown
}

export interface KatazukuData {
  generatedAt: string
  companies: Record<string, unknown>[]
  selections: Selection[]
  appointments: Appointment[]
  events: Record<string, unknown>[]
  enrichedEvents: Record<string, unknown>[]
  activities: Activity[]
  profile: Record<string, unknown>
  profileSuggestions: Record<string, unknown>[]
  people: Person[]
  personNotes: PersonNote[]
  interviews: Interview[]
  submissions: Record<string, unknown>[]
  dossiers: Dossier[]
  meetingPreparations?: MeetingPreparation[]
  meetingRuns: Record<string, unknown>[]
  mailItems: MailItem[]
}

export const READ_KEY_STORAGE = 'katazuku/read-key'

export function getReadKey(): string {
  return localStorage.getItem(READ_KEY_STORAGE) || ''
}

export function saveReadKey(key: string): void {
  localStorage.setItem(READ_KEY_STORAGE, key.trim())
}

export async function fetchKatazukuData(signal?: AbortSignal): Promise<KatazukuData | null> {
  const key = getReadKey()
  if (!key) return null
  const response = await fetch(`/api/data?key=${encodeURIComponent(key)}`, {
    signal,
    cache: 'no-store',
  })
  if (response.status === 401) throw new ReadKeyError()
  if (!response.ok) throw new Error(`データ取得に失敗しました（${response.status}）`)
  return await response.json() as KatazukuData
}

export class ReadKeyError extends Error {
  constructor() { super('合言葉が違います。入力内容を確認してください。') }
}

export function photoUrl(storageKey: string): string {
  return `/api/photo?key=${encodeURIComponent(getReadKey())}&id=${encodeURIComponent(storageKey)}`
}

export function formatDate(value: string, withTime = true): string {
  if (!value) return '未設定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function textValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('、')
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => `${key}: ${textValue(child)}`).filter((line) => !line.endsWith(': ')).join(' / ')
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ'
  return String(value)
}
