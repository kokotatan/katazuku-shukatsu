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

export interface KatazukuData extends Record<string, unknown> {
  schemaVersion: 1
  generatedAt: string
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
  meetingRuns: Record<string, unknown>[]
}
