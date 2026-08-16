/**
 * アプリ群(board/status/inbox/...)が共有する、正本DBスナップショットの型と読み口。
 *
 * 本体はこの層でサーバ `/api/data` を合言葉つきで叩くが、公開版はサーバを持たない。
 * `npm run snapshot` が書き出したローカルの1枚のJSONを読むだけ。
 * 型 `KatazukuData` は本体と同じ形にしてある(private の改善をそのまま持ち込めるように)。
 */

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

export interface Company {
  name: string
  shortName: string
  industry: string
  mypageUrl: string
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
  at?: string
  what?: string
  why?: string
  how?: string
  [key: string]: unknown
}

/** 名寄せが怪しくて本人の確認へ回った入力。公開版で追加(コアの resolveCompany が積む) */
export interface PendingReview {
  name: string
  context: string
  createdAt: string
}

export interface KatazukuData {
  generatedAt: string
  /** 架空データのデモを読んでいるか。公開版で追加 */
  demo: boolean
  companies: Company[]
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
  mailItems: MailItem[]
  pending: PendingReview[]
}

/** 実データのスナップショットがあればそれを、無ければ同梱のデモを読む */
const SOURCES = ['./snapshot.json', './snapshot.demo.json'] as const

export async function fetchKatazukuData(signal?: AbortSignal): Promise<KatazukuData> {
  for (const path of SOURCES) {
    const res = await fetch(`${path}?t=${Date.now()}`, { signal, cache: 'no-store' }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
      return null
    })
    if (!res || !res.ok) continue
    // 開発サーバは存在しないパスにも index.html を200で返す。
    // content-type を見ないと、HTMLをJSONとして読んで無関係な構文エラーになる。
    if (!res.headers.get('content-type')?.includes('json')) continue
    return await res.json() as KatazukuData
  }
  throw new Error('スナップショットが見つかりません。リポジトリのルートで `npm run snapshot -- --demo` を実行してください。')
}

/**
 * 顔写真の実体はDBにもスナップショットにも入れず、storage_key だけを持つ。
 * 本体はこのキーを `/api/photo` で引くが、公開版は写真の配信口を持たない。
 * 実装するときはローカルの保管先を返すこと(鍵をURLに載せない)。
 */
export function photoUrl(_storageKey: string): string | null {
  return null
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

/** 日付までの残り日数。負なら超過 */
export function daysLeft(d: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/** `2026-08-19` `2026/08/19 15:00` `2026-08-19T15:00:00+09:00` のいずれも受ける */
export function parseDate(v: string): Date | null {
  if (!v) return null
  if (/T\d{2}:\d{2}/.test(v)) {
    const iso = new Date(v)
    if (!Number.isNaN(iso.getTime())) return iso
  }
  const m = v.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 終了したトラック(不合格・辞退)か */
export function isClosed(s: Pick<Selection, 'outcome'>): boolean {
  return s.outcome === '不合格' || s.outcome === '辞退'
}
