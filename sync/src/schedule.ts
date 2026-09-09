/**
 * 予定のセマンティックレイヤー。
 *
 * appointmentは就活上の意味を持つ予定、schedule_blockは大学・私用・終日を含む
 * 「その時間を使えるか」の投影として分離する。空き判定は外部カレンダーの取得鮮度も
 * 検証し、情報不足を空きと誤認せず available / conflict / unknown の三値で返す。
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getDatabaseContext, normalizeAppointmentAt, type DatabaseRole } from './db'

export interface ScheduleBlockInput {
  provider?: string
  accountId?: string
  calendarId?: string
  externalId: string
  startAt: string
  endAt: string
  title?: string
  allDay?: boolean
  busy?: boolean
  status?: 'active' | 'cancelled'
  sourceHash?: string
}

export interface SourceSyncStateInput {
  source: string
  accountId?: string
  scopeId?: string
  status: 'success' | 'partial' | 'failed' | 'unknown'
  coveredFrom?: string
  coveredUntil?: string
  attemptedAt: string
  error?: string
}

export interface ScheduleProjectionInput {
  blocks?: ScheduleBlockInput[]
  syncStates?: SourceSyncStateInput[]
  /** trueなら、この入力に無い同sourceのアカウントを現在の同期対象から外す。 */
  replaceSyncSources?: boolean
}

export interface ScheduleProjectionResult {
  created: number
  updated: number
  cancelledMissing: number
  syncStates: number
}

function parseInstant(value: string, field: string): { iso: string; ms: number } {
  const iso = normalizeAppointmentAt(value)
  const ms = Date.parse(iso)
  if (!iso || Number.isNaN(ms)) throw new Error(`${field}がISO日時として解釈できません: ${value}`)
  return { iso, ms }
}

function sourceKey(source: string, accountId: string, scopeId: string): string {
  return `${source}\u0000${accountId}\u0000${scopeId}`
}

/** calendar-fetchの全予定投影と取得状態を、同じDBトランザクション内で反映する。 */
export function applyScheduleProjection(
  db: DatabaseSync,
  input: ScheduleProjectionInput,
): ScheduleProjectionResult {
  const result: ScheduleProjectionResult = { created: 0, updated: 0, cancelledMissing: 0, syncStates: 0 }
  const now = new Date().toISOString()
  const seenBySourceAccount = new Map<string, Set<string>>()

  for (const block of input.blocks ?? []) {
    if (!block.externalId?.trim()) throw new Error('schedule blockのexternalIdは必須です')
    const provider = (block.provider || 'google-calendar').trim()
    const accountId = (block.accountId || '').trim()
    const calendarId = (block.calendarId || '').trim()
    const start = parseInstant(block.startAt, 'schedule block.startAt')
    const end = parseInstant(block.endAt, 'schedule block.endAt')
    if (end.ms <= start.ms) throw new Error(`schedule blockの終了は開始より後である必要があります: ${block.externalId}`)
    const status = block.status === 'cancelled' ? 'cancelled' : 'active'
    const hash = block.sourceHash || createHash('sha256').update(JSON.stringify({
      startAt: start.iso,
      endAt: end.iso,
      title: block.title || '',
      allDay: Boolean(block.allDay),
      busy: block.busy !== false,
      status,
    })).digest('hex')
    const appointment = db.prepare(`
      SELECT id FROM appointment
      WHERE external_id = ? AND (? = '' OR calendar_id = ?)
      ORDER BY id LIMIT 1
    `).get(block.externalId.trim(), calendarId, calendarId) as { id: number } | undefined
    const prior = db.prepare(`
      SELECT id, source_hash AS sourceHash FROM schedule_block
      WHERE provider = ? AND account_id = ? AND calendar_id = ? AND external_id = ?
    `).get(provider, accountId, calendarId, block.externalId.trim()) as { id: number; sourceHash: string } | undefined
    db.prepare(`
      INSERT INTO schedule_block
        (provider, account_id, calendar_id, external_id, appointment_id, start_at, end_at,
         title, all_day, busy, status, source_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, account_id, calendar_id, external_id) DO UPDATE SET
        appointment_id = COALESCE(excluded.appointment_id, schedule_block.appointment_id),
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        title = excluded.title,
        all_day = excluded.all_day,
        busy = excluded.busy,
        status = excluded.status,
        source_hash = excluded.source_hash,
        updated_at = excluded.updated_at
    `).run(
      provider, accountId, calendarId, block.externalId.trim(), appointment?.id ?? null,
      start.iso, end.iso, block.title || '', block.allDay ? 1 : 0, block.busy === false ? 0 : 1,
      status, hash, now,
    )
    if (!prior) result.created += 1
    else if (prior.sourceHash !== hash) result.updated += 1
    const accountKey = `${provider}\u0000${accountId}`
    const seen = seenBySourceAccount.get(accountKey) ?? new Set<string>()
    seen.add(`${calendarId}\u0000${block.externalId.trim()}`)
    seenBySourceAccount.set(accountKey, seen)
  }

  const states = input.syncStates ?? []
  if (input.replaceSyncSources && states.length) {
    const sources = [...new Set(states.map((state) => state.source))]
    const keep = new Set(states.map((state) => sourceKey(state.source, state.accountId || '', state.scopeId || '')))
    for (const source of sources) {
      const rows = db.prepare(`
        SELECT source, account_id AS accountId, scope_id AS scopeId
        FROM source_sync_state WHERE source = ?
      `).all(source) as { source: string; accountId: string; scopeId: string }[]
      for (const row of rows) {
        if (!keep.has(sourceKey(row.source, row.accountId, row.scopeId))) {
          db.prepare('DELETE FROM source_sync_state WHERE source = ? AND account_id = ? AND scope_id = ?')
            .run(row.source, row.accountId, row.scopeId)
        }
      }
    }
  }

  for (const state of states) {
    const accountId = state.accountId || ''
    const scopeId = state.scopeId || ''
    const attempt = parseInstant(state.attemptedAt, 'syncState.attemptedAt').iso
    const coveredFrom = state.coveredFrom ? parseInstant(state.coveredFrom, 'syncState.coveredFrom').iso : ''
    const coveredUntil = state.coveredUntil ? parseInstant(state.coveredUntil, 'syncState.coveredUntil').iso : ''
    if (state.status === 'success' && (!coveredFrom || !coveredUntil || Date.parse(coveredUntil) <= Date.parse(coveredFrom))) {
      throw new Error(`成功した同期には有効な取得期間が必要です: ${state.source}/${accountId}`)
    }
    db.prepare(`
      INSERT INTO source_sync_state
        (source, account_id, scope_id, status, covered_from, covered_until,
         last_attempt_at, last_success_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, account_id, scope_id) DO UPDATE SET
        status = excluded.status,
        covered_from = CASE WHEN excluded.status = 'success' THEN excluded.covered_from ELSE source_sync_state.covered_from END,
        covered_until = CASE WHEN excluded.status = 'success' THEN excluded.covered_until ELSE source_sync_state.covered_until END,
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = CASE WHEN excluded.status = 'success' THEN excluded.last_success_at ELSE source_sync_state.last_success_at END,
        last_error = excluded.last_error
    `).run(
      state.source, accountId, scopeId, state.status,
      coveredFrom, coveredUntil, attempt, state.status === 'success' ? attempt : '',
      (state.error || '').slice(0, 500),
    )
    result.syncStates += 1

    // 正常に全件取得できたアカウントだけ、取得期間内から消えた投影を中止扱いにする。
    // partial/failedで消すと、一時的なAPI障害を予定削除と誤認するため触らない。
    if (state.status === 'success') {
      const seen = seenBySourceAccount.get(`${state.source}\u0000${accountId}`) ?? new Set<string>()
      const current = db.prepare(`
        SELECT id, calendar_id AS calendarId, external_id AS externalId
        FROM schedule_block
        WHERE provider = ? AND account_id = ? AND status = 'active'
          AND start_at < ? AND end_at > ?
      `).all(state.source, accountId, coveredUntil, coveredFrom) as { id: number; calendarId: string; externalId: string }[]
      for (const row of current) {
        if (!seen.has(`${row.calendarId}\u0000${row.externalId}`)) {
          db.prepare("UPDATE schedule_block SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, row.id)
          result.cancelledMissing += 1
        }
      }
    }
  }
  return result
}

export type AvailabilityState = 'available' | 'conflict' | 'unknown'

export interface ScheduleConflict {
  source: 'calendar' | 'appointment' | 'travel'
  id: number
  startAt: string
  endAt: string
  title: string
  company?: string
  appointmentId?: number
}

export interface SyncFreshness {
  source: string
  accountId: string
  scopeId: string
  status: string
  coveredFrom: string
  coveredUntil: string
  lastAttemptAt: string
  lastSuccessAt: string
}

export interface ScheduleAvailability {
  state: AvailabilityState
  available: boolean
  database: ReturnType<typeof getDatabaseContext>
  checkedStartAt: string
  checkedEndAt: string
  conflicts: ScheduleConflict[]
  issues: string[]
  freshness: SyncFreshness[]
}

export interface AvailabilityOptions {
  excludeAppointmentId?: number
  maxSyncAgeMs?: number
  now?: Date
  requireCalendarFreshness?: boolean
  databaseRole?: DatabaseRole
  requireCanonical?: boolean
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart
}

function validMs(value: string): number | undefined {
  const ms = Date.parse(normalizeAppointmentAt(value))
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * 正本DBだけを読んで空き状況を返す。衝突が1件でも分かれば確実にconflict、衝突がなくても
 * カレンダー同期の欠落・期限切れ・非正本DBならunknown。unknownをavailableへ丸めない。
 */
export function getScheduleAvailability(
  db: DatabaseSync,
  startAt: string,
  endAt: string,
  options: AvailabilityOptions = {},
): ScheduleAvailability {
  const start = parseInstant(startAt, 'availability.startAt')
  const end = parseInstant(endAt, 'availability.endAt')
  if (end.ms <= start.ms) throw new Error('空き判定の終了は開始より後である必要があります')
  const database = getDatabaseContext(db, options.databaseRole)
  const issues: string[] = []
  if (options.requireCanonical !== false && database.role !== 'canonical') {
    issues.push(`正本DBではありません(role=${database.role})`)
  }

  const freshness = db.prepare(`
    SELECT source, account_id AS accountId, scope_id AS scopeId, status,
           covered_from AS coveredFrom, covered_until AS coveredUntil,
           last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt
    FROM source_sync_state WHERE source = 'google-calendar'
    ORDER BY account_id, scope_id
  `).all() as SyncFreshness[]
  if (options.requireCalendarFreshness !== false) {
    const nowMs = (options.now ?? new Date()).getTime()
    const maxAge = options.maxSyncAgeMs ?? 10 * 60 * 1000
    if (!freshness.length) issues.push('Google Calendarの同期実績がありません')
    for (const state of freshness) {
      if (state.status !== 'success') issues.push(`Calendar同期が未完了です: ${state.accountId || state.scopeId || 'default'}(${state.status})`)
      const successMs = validMs(state.lastSuccessAt)
      if (successMs === undefined || nowMs - successMs > maxAge) {
        issues.push(`Calendar同期が古いです: ${state.accountId || state.scopeId || 'default'}`)
      }
      const coveredFrom = validMs(state.coveredFrom)
      const coveredUntil = validMs(state.coveredUntil)
      if (coveredFrom === undefined || coveredUntil === undefined || coveredFrom > start.ms || coveredUntil < end.ms) {
        issues.push(`Calendar同期期間が候補日時を覆っていません: ${state.accountId || state.scopeId || 'default'}`)
      }
    }
  }

  const profile = db.prepare(`
    SELECT online_before_minutes AS onlineBefore, online_after_minutes AS onlineAfter,
           in_person_before_minutes AS inPersonBefore, in_person_after_minutes AS inPersonAfter
    FROM mobility_profile WHERE id = 1
  `).get() as { onlineBefore: number; onlineAfter: number; inPersonBefore: number; inPersonAfter: number } | undefined
  const mobilityRows = db.prepare(`
    SELECT appointment_id AS appointmentId, attendance_mode AS mode,
           arrival_buffer_minutes AS arrivalBuffer, departure_buffer_minutes AS departureBuffer,
           remote_setup_minutes AS remoteSetup
    FROM appointment_mobility
  `).all() as { appointmentId: number; mode: string; arrivalBuffer: number | null; departureBuffer: number | null; remoteSetup: number | null }[]
  const mobility = new Map(mobilityRows.map((row) => [row.appointmentId, row]))
  const buffers = (appointmentId?: number): { before: number; after: number } => {
    if (!appointmentId) return { before: 0, after: 0 }
    const row = mobility.get(appointmentId)
    if (!row) return { before: 0, after: 0 }
    if (row.mode === 'online') return {
      before: row.remoteSetup ?? row.arrivalBuffer ?? profile?.onlineBefore ?? 0,
      after: row.departureBuffer ?? profile?.onlineAfter ?? 0,
    }
    if (row.mode === 'in_person' || row.mode === 'hybrid') return {
      before: row.arrivalBuffer ?? profile?.inPersonBefore ?? 0,
      after: row.departureBuffer ?? profile?.inPersonAfter ?? 0,
    }
    return { before: row.arrivalBuffer ?? row.remoteSetup ?? 0, after: row.departureBuffer ?? 0 }
  }

  const conflicts: ScheduleConflict[] = []
  // Calendar projectionがあるappointmentは、そのprojectionのbusyを正とする。
  // availability=FREEの宿泊予定までappointment fallbackで滞在期間全体の占有へ
  // 戻してしまうと、Calendar側のfree/busy指定が無効になるため。
  const linkedProjectedAppointments = new Set<number>()
  const blocks = db.prepare(`
    SELECT id, appointment_id AS appointmentId, start_at AS startAt, end_at AS endAt, title, busy
    FROM schedule_block WHERE status = 'active'
  `).all() as { id: number; appointmentId: number | null; startAt: string; endAt: string; title: string; busy: number }[]
  for (const block of blocks) {
    if (block.appointmentId === options.excludeAppointmentId) continue
    if (block.appointmentId) linkedProjectedAppointments.add(block.appointmentId)
    if (block.busy !== 1) continue
    const blockStart = validMs(block.startAt)
    const blockEnd = validMs(block.endAt)
    if (blockStart === undefined || blockEnd === undefined) continue
    const buffer = buffers(block.appointmentId ?? undefined)
    const effectiveStart = blockStart - buffer.before * 60_000
    const effectiveEnd = blockEnd + buffer.after * 60_000
    if (overlaps(start.ms, end.ms, effectiveStart, effectiveEnd)) {
      conflicts.push({
        source: 'calendar', id: block.id, appointmentId: block.appointmentId ?? undefined,
        startAt: new Date(effectiveStart).toISOString(), endAt: new Date(effectiveEnd).toISOString(),
        title: block.title || '予定あり',
      })
    }
  }

  const appointments = db.prepare(`
    SELECT a.id, a.at, a.end_at AS endAt, a.title, a.flexible,
           CASE WHEN c.short_name <> '' THEN c.short_name ELSE c.name END AS company
    FROM appointment a
    JOIN selection s ON s.id = a.selection_id
    JOIN company c ON c.id = s.company_id
    WHERE a.status NOT IN ('中止', '完了')
  `).all() as { id: number; at: string; endAt: string; title: string; flexible: number; company: string }[]
  for (const appointment of appointments) {
    if (appointment.id === options.excludeAppointmentId || appointment.flexible === 1 || linkedProjectedAppointments.has(appointment.id)) continue
    const appointmentStart = validMs(appointment.at)
    if (appointmentStart === undefined) continue
    const parsedEnd = validMs(appointment.endAt)
    const appointmentEnd = parsedEnd !== undefined && parsedEnd > appointmentStart ? parsedEnd : appointmentStart + 60 * 60_000
    const buffer = buffers(appointment.id)
    const effectiveStart = appointmentStart - buffer.before * 60_000
    const effectiveEnd = appointmentEnd + buffer.after * 60_000
    if (overlaps(start.ms, end.ms, effectiveStart, effectiveEnd)) {
      conflicts.push({
        source: 'appointment', id: appointment.id, appointmentId: appointment.id,
        startAt: new Date(effectiveStart).toISOString(), endAt: new Date(effectiveEnd).toISOString(),
        title: appointment.title, company: appointment.company,
      })
    }
  }

  const travel = db.prepare(`
    SELECT id, depart_at AS startAt, arrive_at AS endAt, transport_mode AS mode
    FROM travel_segment WHERE status <> 'cancelled'
  `).all() as { id: number; startAt: string; endAt: string; mode: string }[]
  for (const segment of travel) {
    const segmentStart = validMs(segment.startAt)
    const segmentEnd = validMs(segment.endAt)
    if (segmentStart !== undefined && segmentEnd !== undefined && overlaps(start.ms, end.ms, segmentStart, segmentEnd)) {
      conflicts.push({
        source: 'travel', id: segment.id, startAt: new Date(segmentStart).toISOString(),
        endAt: new Date(segmentEnd).toISOString(), title: `移動(${segment.mode})`,
      })
    }
  }

  const state: AvailabilityState = conflicts.length ? 'conflict' : issues.length ? 'unknown' : 'available'
  return {
    state,
    available: state === 'available',
    database,
    checkedStartAt: start.iso,
    checkedEndAt: end.iso,
    conflicts,
    issues: [...new Set(issues)],
    freshness,
  }
}
