/** 閲覧データの境界。ブラウザ・同期・保管側で同じ検査を使う。 */
import type { KatazukuData } from './viewer-types.js'
export const SNAPSHOT_VERSION = 1
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
export const SNAPSHOT_ARRAYS = ['companies', 'selections', 'appointments', 'events', 'enrichedEvents', 'activities',
  'profileSuggestions', 'people', 'personNotes', 'interviews', 'submissions', 'dossiers', 'mailItems', 'pending', 'meetingRuns'] as const

const blockedKeys = new Set(['password', 'passwd', 'loginid', 'cookie', 'cookies', 'accesstoken', 'refreshtoken',
  'authorization', 'clientsecret', 'apikey', 'privatekey', 'secret', '__proto__', 'prototype', 'constructor'])
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const blockedKey = (key: string) => blockedKeys.has(key.replace(/[-_]/g, '').toLowerCase()) || ['__proto__', 'prototype', 'constructor'].includes(key)

/** 秘密の値をエラーに含めず、JSONとして扱える範囲と既知の秘密フィールドを検査する。 */
function inspect(value: unknown, depth = 0): void {
  if (depth > 24) throw new Error('閲覧データの階層が深すぎます')
  if (typeof value === 'string') {
    if (value.length > 262_144 || /^data:(?:image|audio|video)\//i.test(value) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) throw new Error('閲覧データに格納できない値が含まれています')
  } else if (Array.isArray(value)) {
    if (value.length > 50_000) throw new Error('閲覧データの件数が多すぎます')
    for (const child of value) inspect(child, depth + 1)
  } else if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (blockedKey(key)) throw new Error('閲覧データに認証情報のフィールドが含まれています')
      inspect(child, depth + 1)
    }
  } else if (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('閲覧データの値が不正です')
  }
}

export function validateSnapshot(value: unknown): asserts value is KatazukuData {
  if (!object(value) || value.schemaVersion !== SNAPSHOT_VERSION) throw new Error('閲覧データの形式が対応するバージョンではありません')
  if (typeof value.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('閲覧データの更新日時が不正です')
  const allowed = new Set<string>(['schemaVersion', 'generatedAt', 'profile', ...SNAPSHOT_ARRAYS])
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('閲覧データに未対応の項目があります')
  if (!object(value.profile)) throw new Error('プロフィールの形式が不正です')
  for (const name of SNAPSHOT_ARRAYS) {
    if (!Array.isArray(value[name]) || !(value[name] as unknown[]).every(object)) throw new Error('閲覧データの一覧の形式が不正です')
  }
  const strings: Partial<Record<typeof SNAPSHOT_ARRAYS[number], string[]>> = {
    companies: ['name', 'shortName', 'industry', 'mypageUrl', 'memo'],
    selections: ['company', 'season', 'position', 'priority', 'status', 'outcome', 'nextAction', 'nextDate', 'esUrl', 'memo'],
    appointments: ['company', 'at', 'endAt', 'kind', 'title', 'url', 'location', 'person', 'status'],
    people: ['name', 'company', 'role', 'category', 'metAt', 'howMet', 'followUp', 'updatedAt'],
    personNotes: ['personName', 'at', 'note', 'sourceRef'],
    interviews: ['occurredAt', 'title', 'summary', 'sourceRef'],
    dossiers: ['company', 'summary', 'researchedAt', 'sourceRef'],
    mailItems: ['id', 'receivedAt', 'sender', 'subject', 'summary', 'category', 'deadline', 'status', 'sourceRef'],
    pending: ['name', 'context', 'createdAt'],
  }
  for (const [name, fields] of Object.entries(strings)) {
    for (const row of value[name] as Record<string, unknown>[]) {
      if (fields.some(field => typeof row[field] !== 'string')) throw new Error('閲覧データの項目の形式が不正です')
    }
  }
  const ids: Partial<Record<typeof SNAPSHOT_ARRAYS[number], string[]>> = {
    selections: ['id', 'companyId'], appointments: ['id', 'selectionId'], people: ['id'], personNotes: ['id', 'personId'], interviews: ['id'], dossiers: ['companyId'],
  }
  for (const [name, fields] of Object.entries(ids)) for (const row of value[name] as Record<string, unknown>[]) {
    if (fields.some(field => !Number.isSafeInteger(row[field]) || Number(row[field]) <= 0)) throw new Error('閲覧データの識別子が不正です')
  }
  for (const row of value.selections as Record<string, unknown>[]) {
    if (typeof row.submitted !== 'boolean' || !Array.isArray(row.steps) || !row.steps.every(step => typeof step === 'string')) throw new Error('選考の形式が不正です')
  }
  for (const row of value.dossiers as Record<string, unknown>[]) {
    if (!object(row.facts) || !Array.isArray(row.sources) || !row.sources.every(object)) throw new Error('企業研究の形式が不正です')
  }
  for (const row of value.interviews as Record<string, unknown>[]) if (!object(row.detail)) throw new Error('面接記録の形式が不正です')
  for (const row of value.mailItems as Record<string, unknown>[]) if (![0, 1, false, true].includes(row.needsAction as number)) throw new Error('メールの形式が不正です')
  inspect(value)
}

/** 正本の自由項目に認証情報が紛れても、閲覧用のコピーには持ち出さない。 */
export function stripSnapshotSecrets(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new Error('閲覧データの階層が深すぎます')
  if (typeof value === 'string') return /^data:(?:image|audio|video)\//i.test(value) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ? '' : value
  if (Array.isArray(value)) return value.map(child => stripSnapshotSecrets(child, depth + 1))
  if (!object(value)) return value
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, child] of Object.entries(value)) if (!blockedKey(key) && child !== undefined) result[key] = stripSnapshotSecrets(child, depth + 1)
  return result
}
