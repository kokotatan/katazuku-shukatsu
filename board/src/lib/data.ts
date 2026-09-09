/**
 * 正本DBのスナップショットを /api/data から読むデータ層(全アプリ共通)。
 * サインイン不要。合言葉(READ_SECRET)を初回に1回入れるだけ。
 * agentがDBに書くたびプッシュされるので、数秒後にはここに最新が映る。
 */

import { fetchKatazukuData } from '../../../shared/src/index'
export { READ_KEY_STORAGE } from '../../../shared/src/index'

export interface Track {
  id: number
  company: string
  period: string
  position: string
  priority: string
  status: string
  outcome: string
  steps: string[]
  nextAction: string
  deadline: string
  deadlineDate: Date | null
  submitted: boolean
  esUrl: string
  memo: string
}

export interface Master {
  company: string
  officialName: string
  industry: string
  mypageUrl: string
  loginId: string
  memo: string
}

export interface Appointment {
  selectionId: number
  company: string
  at: string
  atDate: Date | null
  hasTime: boolean
  kind: string
  title: string
  url: string
  location: string
  person: string
  status: string
}

export interface Activity {
  ts: string
  by: string
  action: string
  why: string
  how: string
  link: string
  result: string
}

export interface AllData {
  tracks: Track[]
  master: Master[]
  appointments: Appointment[]
  activities: Activity[]
  generatedAt: Date | null
  loadedAt: Date
}

export function parseSheetDate(v: string): Date | null {
  const m = v.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  return isNaN(d.getTime()) ? null : d
}

export function daysLeft(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

interface RawSnapshot {
  generatedAt?: string
  companies?: { name?: string; shortName?: string; industry?: string; mypageUrl?: string; loginId?: string; memo?: string }[]
  selections?: {
    id?: number; company?: string; season?: string; position?: string; priority?: string; status?: string
    outcome?: string; steps?: string[]; nextAction?: string; nextDate?: string; submitted?: boolean; esUrl?: string; memo?: string
  }[]
  appointments?: { selectionId?: number; company?: string; at?: string; kind?: string; title?: string; url?: string; location?: string; person?: string; status?: string }[]
  activities?: { ts?: unknown; by?: unknown; action?: unknown; why?: unknown; how?: unknown; link?: unknown; result?: unknown }[]
}

/** 合言葉が未設定ならnull、設定済みなら認証APIから取得する。 */
export async function fetchAll(): Promise<AllData | null> {
  const raw = await fetchKatazukuData()
  return raw ? snapshotToAllData(raw) : null
}

export function snapshotToAllData(raw: RawSnapshot): AllData {
  const tracks: Track[] = (raw.selections ?? []).map((s) => {
    const deadline = s.nextDate ?? ''
    return {
      id: s.id ?? 0,
      company: s.company ?? '',
      period: s.season ?? '',
      position: s.position ?? '',
      priority: s.priority ?? '',
      status: s.status ?? '',
      outcome: s.outcome ?? '',
      steps: (s.steps ?? []).filter(Boolean),
      nextAction: s.nextAction ?? '',
      deadline,
      deadlineDate: deadline ? parseSheetDate(deadline.replace(/\//g, '-')) : null,
      submitted: !!s.submitted,
      esUrl: s.esUrl ?? '',
      memo: s.memo ?? '',
    }
  })

  const master: Master[] = (raw.companies ?? []).map((c) => ({
    company: c.shortName || c.name || '',
    officialName: c.name ?? '',
    industry: c.industry ?? '',
    mypageUrl: c.mypageUrl ?? '',
    loginId: c.loginId ?? '',
    memo: c.memo ?? '',
  }))

  const appointments: Appointment[] = (raw.appointments ?? [])
    .filter((a) => (a.status ?? '予定') === '予定')
    .map((a) => ({
      selectionId: a.selectionId ?? 0,
      company: a.company ?? '',
      at: a.at ?? '',
      atDate: a.at ? parseSheetDate(a.at.replace(/\//g, '-')) : null,
      hasTime: /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(a.at ?? ''),
      kind: a.kind ?? '',
      title: a.title ?? '',
      url: a.url ?? '',
      location: a.location ?? '',
      person: a.person ?? '',
      status: a.status ?? '予定',
    }))
    .sort((x, y) => (x.atDate?.getTime() ?? 0) - (y.atDate?.getTime() ?? 0))

  const activities: Activity[] = (raw.activities ?? [])
    .map((a) => ({ ts: String(a.ts ?? ''), by: String(a.by ?? ''), action: String(a.action ?? ''), why: String(a.why ?? ''), how: String(a.how ?? ''), link: String(a.link ?? ''), result: String(a.result ?? '') }))
    .reverse()

  return {
    tracks,
    master,
    appointments,
    activities,
    generatedAt: raw.generatedAt ? new Date(raw.generatedAt) : null,
    loadedAt: new Date(),
  }
}
