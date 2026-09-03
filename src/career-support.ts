/**
 * 就活エージェント・就活メディア・イベント運営者を、応募先企業/selectionから分離して扱う。
 * このモジュールは専用テーブルを自分で初期化するため、既存DBのappointment制約を変更しない。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeAppointmentAt } from './db.js'
import { ensureCareerSupportSchema } from './career-support-schema.js'

export { ensureCareerSupportSchema } from './career-support-schema.js'

export type CareerOrganizationKind = 'career_agent' | 'event_organizer' | 'recruiting_media' | 'university' | 'other'
export type CareerMeetingStatus = 'review' | 'scheduled' | 'completed' | 'cancelled'

export interface CareerMeetingInput {
  externalId: string
  calendarId?: string
  title: string
  startAt: string
  endAt?: string
  kind?: string
  url?: string
  location?: string
  organization?: string
  organizationKind?: CareerOrganizationKind
  aliases?: string[]
  status?: CareerMeetingStatus | '予定' | '完了' | '中止'
  recordable?: boolean
  sourceHash?: string
}

export interface CareerMeetingRow {
  id: number
  organizationId: number | null
  organization: string
  externalId: string
  calendarId: string
  title: string
  startAt: string
  endAt: string
  kind: string
  url: string
  location: string
  status: CareerMeetingStatus
  recordable: boolean
}

export function normalizeOrganizationAlias(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\u3000・･,，.。／/\\()（）\[\]【】「」『』_-]/g, '')
}

export function upsertCareerOrganization(
  db: DatabaseSync,
  input: { name: string; shortName?: string; kind?: CareerOrganizationKind; website?: string; memo?: string; aliases?: string[] },
): number {
  ensureCareerSupportSchema(db)
  const name = input.name.trim()
  if (!name) throw new Error('支援組織名は必須です')
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO career_organization (name, short_name, kind, website, memo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      short_name = CASE WHEN career_organization.short_name = '' THEN excluded.short_name ELSE career_organization.short_name END,
      kind = CASE WHEN career_organization.kind = 'other' THEN excluded.kind ELSE career_organization.kind END,
      website = CASE WHEN career_organization.website = '' THEN excluded.website ELSE career_organization.website END,
      memo = CASE WHEN career_organization.memo = '' THEN excluded.memo ELSE career_organization.memo END,
      updated_at = excluded.updated_at
  `).run(name, input.shortName || name, input.kind || 'other', input.website || '', input.memo || '', now)
  const row = db.prepare('SELECT id FROM career_organization WHERE name = ?').get(name) as { id: number }
  for (const alias of [name, input.shortName || '', ...(input.aliases || [])]) {
    const trimmed = alias.trim()
    const norm = normalizeOrganizationAlias(trimmed)
    if (!norm) continue
    db.prepare(`
      INSERT INTO career_organization_alias (alias_norm, alias, organization_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(alias_norm) DO UPDATE SET organization_id = excluded.organization_id
    `).run(norm, trimmed, row.id, now)
  }
  return row.id
}

export function resolveCareerOrganization(db: DatabaseSync, text: string): number | undefined {
  ensureCareerSupportSchema(db)
  const normalizedText = normalizeOrganizationAlias(text)
  const aliases = db.prepare(`
    SELECT alias_norm AS aliasNorm, organization_id AS organizationId
    FROM career_organization_alias ORDER BY length(alias_norm) DESC
  `).all() as { aliasNorm: string; organizationId: number }[]
  return aliases.find((row) => row.aliasNorm.length >= 3 && normalizedText.includes(row.aliasNorm))?.organizationId
}

function statusOf(value: CareerMeetingInput['status'], resolved: boolean): CareerMeetingStatus {
  if (value === 'cancelled' || value === '中止') return 'cancelled'
  if (value === 'completed' || value === '完了') return 'completed'
  if (value === 'review') return 'review'
  return resolved ? 'scheduled' : 'review'
}

export function upsertCareerMeeting(db: DatabaseSync, input: CareerMeetingInput): { id: number; created: boolean; status: CareerMeetingStatus } {
  ensureCareerSupportSchema(db)
  if (!input.externalId?.trim() || !input.title?.trim() || !input.startAt?.trim()) {
    throw new Error('支援面談はexternalId/title/startAtが必須です')
  }
  const startAt = normalizeAppointmentAt(input.startAt)
  const endAt = input.endAt ? normalizeAppointmentAt(input.endAt) : ''
  if (!startAt || Number.isNaN(Date.parse(startAt))) throw new Error(`startAtが不正です: ${input.startAt}`)
  if (endAt && Number.isNaN(Date.parse(endAt))) throw new Error(`endAtが不正です: ${input.endAt}`)
  let organizationId: number | undefined
  if (input.organization?.trim()) {
    organizationId = upsertCareerOrganization(db, {
      name: input.organization,
      shortName: input.aliases?.[0],
      kind: input.organizationKind || 'other',
      aliases: input.aliases,
    })
  } else {
    organizationId = resolveCareerOrganization(db, `${input.title}\n${input.location || ''}`)
  }
  const status = statusOf(input.status, Boolean(organizationId))
  const recordable = input.recordable ?? /面談|面接|説明会|セミナー|イベント|相談|1on1/i.test(`${input.kind || ''} ${input.title}`)
  const now = new Date().toISOString()
  const hash = input.sourceHash || createHash('sha256').update(JSON.stringify({
    title: input.title, startAt, endAt, kind: input.kind || '面談', url: input.url || '',
    location: input.location || '', organizationId: organizationId || null, status, recordable,
  })).digest('hex')
  const prior = db.prepare('SELECT id FROM career_meeting WHERE calendar_id = ? AND external_id = ?')
    .get(input.calendarId || '', input.externalId.trim()) as { id: number } | undefined
  db.prepare(`
    INSERT INTO career_meeting
      (organization_id, external_id, calendar_id, title, start_at, end_at, kind, url, location,
       status, recordable, source_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(calendar_id, external_id) DO UPDATE SET
      organization_id = COALESCE(excluded.organization_id, career_meeting.organization_id),
      title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at,
      kind = excluded.kind, url = CASE WHEN excluded.url <> '' THEN excluded.url ELSE career_meeting.url END,
      location = excluded.location,
      status = CASE WHEN career_meeting.status = 'completed' THEN 'completed' ELSE excluded.status END,
      recordable = excluded.recordable, source_hash = excluded.source_hash, updated_at = excluded.updated_at
  `).run(
    organizationId ?? null, input.externalId.trim(), input.calendarId || '', input.title.trim(), startAt, endAt,
    input.kind || '面談', input.url || '', input.location || '', status, recordable ? 1 : 0, hash, now, now,
  )
  const row = db.prepare('SELECT id, status FROM career_meeting WHERE calendar_id = ? AND external_id = ?')
    .get(input.calendarId || '', input.externalId.trim()) as { id: number; status: CareerMeetingStatus }
  if (row.status === 'scheduled' && recordable) {
    db.prepare("INSERT OR IGNORE INTO career_meeting_run (id, career_meeting_id, state, updated_at) VALUES (?, ?, 'armed', ?)")
      .run(randomUUID(), row.id, now)
  }
  return { id: row.id, created: !prior, status: row.status }
}

export function listCareerMeetings(db: DatabaseSync): CareerMeetingRow[] {
  ensureCareerSupportSchema(db)
  return (db.prepare(`
    SELECT m.id, m.organization_id AS organizationId,
      COALESCE(NULLIF(o.short_name, ''), o.name, '要確認') AS organization,
      m.external_id AS externalId, m.calendar_id AS calendarId, m.title,
      m.start_at AS startAt, m.end_at AS endAt, m.kind, m.url, m.location,
      m.status, m.recordable
    FROM career_meeting m LEFT JOIN career_organization o ON o.id = m.organization_id
    ORDER BY m.start_at, m.id
  `).all() as (Omit<CareerMeetingRow, 'recordable'> & { recordable: number })[]).map((row) => ({
    ...row,
    recordable: Boolean(row.recordable),
  }))
}
