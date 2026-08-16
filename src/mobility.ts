/**
 * 対面・オンライン予定を、場所と移動時間を含めて扱うDB API。
 * 住所や移動履歴は個人性が高いため、platform snapshotには含めない。
 */
import type { DatabaseSync } from 'node:sqlite'
import { ensurePlatformSchema } from './platform.js'
import { transaction } from './inputs.js'

export type PlaceKind = 'home' | 'campus' | 'station' | 'office' | 'hotel' | 'coworking' | 'other'
export type PlacePrivacy = 'private' | 'shared' | 'public'
export type AttendanceMode = 'online' | 'in_person' | 'hybrid' | 'unknown'
export type MobilityStatus = 'unreviewed' | 'feasible' | 'tight' | 'infeasible' | 'confirmed'
export type TransportMode = 'walk' | 'public_transit' | 'rail' | 'flight' | 'car' | 'taxi' | 'other'
export type TravelStatus = 'planned' | 'reserved' | 'ticketed' | 'completed' | 'cancelled'

export interface PlaceInput {
  key: string
  name: string
  kind?: PlaceKind
  companyId?: number | null
  address?: string
  latitude?: number | null
  longitude?: number | null
  timezone?: string
  provider?: string
  externalId?: string
  privacy?: PlacePrivacy
  sourceRef?: string
}

export interface MobilityProfileInput {
  homePlaceId?: number | null
  campusPlaceId?: number | null
  onlineBeforeMinutes?: number
  onlineAfterMinutes?: number
  inPersonBeforeMinutes?: number
  inPersonAfterMinutes?: number
  maxInPersonPerDay?: number
  allowOnlineInTransit?: boolean
  timezone?: string
  updatedBy?: string
}

export interface AppointmentMobilityInput {
  appointmentId: number
  attendanceMode: AttendanceMode
  placeId?: number | null
  arrivalBufferMinutes?: number | null
  departureBufferMinutes?: number | null
  remoteSetupMinutes?: number | null
  mobilityStatus?: MobilityStatus
  decisionReason?: string
  sourceRef?: string
}

export interface RouteEstimateInput {
  fromPlaceId: number
  toPlaceId: number
  transportMode?: TransportMode
  durationMinutes: number
  bufferMinutes?: number
  provider?: string
  sourceRef: string
  validAt?: string
}

export interface TravelSegmentInput {
  fromAppointmentId?: number | null
  toAppointmentId?: number | null
  fromPlaceId: number
  toPlaceId: number
  departAt: string
  arriveAt: string
  transportMode?: TransportMode
  provider?: string
  routeRef?: string
  durationMinutes?: number
  bufferMinutes?: number
  status?: TravelStatus
  costAmount?: number | null
  currency?: string
  reimbursable?: boolean
  calendarExternalId?: string
  sourceRef: string
}

interface PlaceDbRow {
  id: number
  kind: PlaceKind
  companyId: number | null
  address: string
  latitude: number | null
  longitude: number | null
  timezone: string
  provider: string
  externalId: string
  privacy: PlacePrivacy
  sourceRef: string
}

interface MobilityProfileDbRow {
  homePlaceId: number | null
  campusPlaceId: number | null
  onlineBeforeMinutes: number
  onlineAfterMinutes: number
  inPersonBeforeMinutes: number
  inPersonAfterMinutes: number
  maxInPersonPerDay: number
  allowOnlineInTransit: number
  timezone: string
}

const PLACE_KINDS = new Set<PlaceKind>(['home', 'campus', 'station', 'office', 'hotel', 'coworking', 'other'])
const PLACE_PRIVACY = new Set<PlacePrivacy>(['private', 'shared', 'public'])
const ATTENDANCE_MODES = new Set<AttendanceMode>(['online', 'in_person', 'hybrid', 'unknown'])
const MOBILITY_STATUSES = new Set<MobilityStatus>(['unreviewed', 'feasible', 'tight', 'infeasible', 'confirmed'])
const TRANSPORT_MODES = new Set<TransportMode>(['walk', 'public_transit', 'rail', 'flight', 'car', 'taxi', 'other'])
const TRAVEL_STATUSES = new Set<TravelStatus>(['planned', 'reserved', 'ticketed', 'completed', 'cancelled'])

function assertInteger(value: number | undefined | null, field: string, nullable = false): void {
  if (nullable && (value === undefined || value === null)) return
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(field + ' は0以上の整数です')
}

function assertIso(value: string, field: string): void {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(field + ' が不正です')
}

function assertExists(db: DatabaseSync, table: 'place' | 'appointment', id: number | null | undefined, field: string): void {
  if (id === undefined || id === null) return
  if (!Number.isInteger(id) || id <= 0) throw new Error(field + ' が不正です')
  if (!db.prepare('SELECT id FROM ' + table + ' WHERE id = ?').get(id)) {
    throw new Error(field + ' が見つかりません: ' + id)
  }
}

function own<T>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function upsertPlace(
  db: DatabaseSync,
  input: PlaceInput,
): { id: number; created: boolean } {
  ensurePlatformSchema(db)
  const key = input.key?.trim()
  const name = input.name?.trim()
  const kind = input.kind || 'other'
  const privacy = input.privacy || 'private'
  if (!key || !name) throw new Error('place.key/name は必須です')
  if (!PLACE_KINDS.has(kind)) throw new Error('place.kind が不正です')
  if (!PLACE_PRIVACY.has(privacy)) throw new Error('place.privacy が不正です')
  if (input.latitude !== undefined && input.latitude !== null && (
    !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
  )) throw new Error('place.latitude が不正です')
  if (input.longitude !== undefined && input.longitude !== null && (
    !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
  )) throw new Error('place.longitude が不正です')
  if (input.companyId !== undefined && input.companyId !== null) {
    if (!Number.isInteger(input.companyId) || input.companyId <= 0) throw new Error('place.companyId が不正です')
    if (!db.prepare('SELECT id FROM company WHERE id = ?').get(input.companyId)) {
      throw new Error('place.companyId が見つかりません: ' + input.companyId)
    }
  }
  return transaction(db, () => {
    const current = db.prepare(
      'SELECT id, kind, company_id AS companyId, address, latitude, longitude, timezone, provider, ' +
      'external_id AS externalId, privacy, source_ref AS sourceRef FROM place WHERE place_key = ?',
    ).get(key) as unknown as PlaceDbRow | undefined
    const now = new Date().toISOString()
    if (current) {
      db.prepare(
        'UPDATE place SET name = ?, kind = ?, company_id = ?, address = ?, latitude = ?, longitude = ?, ' +
        'timezone = ?, provider = ?, external_id = ?, privacy = ?, source_ref = ?, updated_at = ? WHERE id = ?',
      ).run(
        name,
        input.kind ?? current.kind,
        own(input, 'companyId') ? input.companyId ?? null : current.companyId,
        own(input, 'address') ? input.address || '' : current.address,
        own(input, 'latitude') ? input.latitude ?? null : current.latitude,
        own(input, 'longitude') ? input.longitude ?? null : current.longitude,
        input.timezone ?? current.timezone,
        input.provider ?? current.provider,
        input.externalId ?? current.externalId,
        input.privacy ?? current.privacy,
        input.sourceRef ?? current.sourceRef,
        now,
        current.id,
      )
      return { id: current.id, created: false }
    }
    const result = db.prepare(
      'INSERT INTO place ' +
      '(place_key, name, kind, company_id, address, latitude, longitude, timezone, provider, external_id, privacy, source_ref, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      key,
      name,
      kind,
      input.companyId ?? null,
      input.address || '',
      input.latitude ?? null,
      input.longitude ?? null,
      input.timezone || 'Asia/Tokyo',
      input.provider || '',
      input.externalId || '',
      privacy,
      input.sourceRef || '',
      now,
    )
    return { id: Number(result.lastInsertRowid), created: true }
  })
}

export function setMobilityProfile(db: DatabaseSync, input: MobilityProfileInput): Record<string, unknown> {
  ensurePlatformSchema(db)
  const current = db.prepare(
    'SELECT home_place_id AS homePlaceId, campus_place_id AS campusPlaceId, ' +
    'online_before_minutes AS onlineBeforeMinutes, online_after_minutes AS onlineAfterMinutes, ' +
    'in_person_before_minutes AS inPersonBeforeMinutes, in_person_after_minutes AS inPersonAfterMinutes, ' +
    'max_in_person_per_day AS maxInPersonPerDay, allow_online_in_transit AS allowOnlineInTransit, timezone ' +
    'FROM mobility_profile WHERE id = 1',
  ).get() as unknown as MobilityProfileDbRow | undefined
  const homePlaceId = own(input, 'homePlaceId') ? input.homePlaceId ?? null : current?.homePlaceId ?? null
  const campusPlaceId = own(input, 'campusPlaceId') ? input.campusPlaceId ?? null : current?.campusPlaceId ?? null
  const onlineBeforeMinutes = input.onlineBeforeMinutes ?? current?.onlineBeforeMinutes ?? 15
  const onlineAfterMinutes = input.onlineAfterMinutes ?? current?.onlineAfterMinutes ?? 15
  const inPersonBeforeMinutes = input.inPersonBeforeMinutes ?? current?.inPersonBeforeMinutes ?? 30
  const inPersonAfterMinutes = input.inPersonAfterMinutes ?? current?.inPersonAfterMinutes ?? 30
  const maxInPersonPerDay = input.maxInPersonPerDay ?? current?.maxInPersonPerDay ?? 2
  for (const [field, value] of Object.entries({
    onlineBeforeMinutes,
    onlineAfterMinutes,
    inPersonBeforeMinutes,
    inPersonAfterMinutes,
    maxInPersonPerDay,
  })) assertInteger(value, field)
  assertExists(db, 'place', homePlaceId, 'homePlaceId')
  assertExists(db, 'place', campusPlaceId, 'campusPlaceId')
  db.prepare(
    'INSERT INTO mobility_profile ' +
    '(id, home_place_id, campus_place_id, online_before_minutes, online_after_minutes, ' +
    'in_person_before_minutes, in_person_after_minutes, max_in_person_per_day, allow_online_in_transit, ' +
    'timezone, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET home_place_id = excluded.home_place_id, campus_place_id = excluded.campus_place_id, ' +
    'online_before_minutes = excluded.online_before_minutes, online_after_minutes = excluded.online_after_minutes, ' +
    'in_person_before_minutes = excluded.in_person_before_minutes, in_person_after_minutes = excluded.in_person_after_minutes, ' +
    'max_in_person_per_day = excluded.max_in_person_per_day, allow_online_in_transit = excluded.allow_online_in_transit, ' +
    'timezone = excluded.timezone, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
  ).run(
    homePlaceId,
    campusPlaceId,
    onlineBeforeMinutes,
    onlineAfterMinutes,
    inPersonBeforeMinutes,
    inPersonAfterMinutes,
    maxInPersonPerDay,
    (input.allowOnlineInTransit ?? Boolean(current?.allowOnlineInTransit)) ? 1 : 0,
    input.timezone || String(current?.timezone || 'Asia/Tokyo'),
    new Date().toISOString(),
    input.updatedBy || 'agent',
  )
  return db.prepare(
    'SELECT home_place_id AS homePlaceId, campus_place_id AS campusPlaceId, ' +
    'online_before_minutes AS onlineBeforeMinutes, online_after_minutes AS onlineAfterMinutes, ' +
    'in_person_before_minutes AS inPersonBeforeMinutes, in_person_after_minutes AS inPersonAfterMinutes, ' +
    'max_in_person_per_day AS maxInPersonPerDay, allow_online_in_transit AS allowOnlineInTransit, ' +
    'timezone, updated_at AS updatedAt, updated_by AS updatedBy FROM mobility_profile WHERE id = 1',
  ).get() as Record<string, unknown>
}

export function setAppointmentMobility(
  db: DatabaseSync,
  input: AppointmentMobilityInput,
): { appointmentId: number; created: boolean } {
  ensurePlatformSchema(db)
  assertExists(db, 'appointment', input.appointmentId, 'appointmentId')
  if (!ATTENDANCE_MODES.has(input.attendanceMode)) throw new Error('attendanceMode が不正です')
  const status = input.mobilityStatus || 'unreviewed'
  if (!MOBILITY_STATUSES.has(status)) throw new Error('mobilityStatus が不正です')
  if ((input.attendanceMode === 'in_person' || input.attendanceMode === 'hybrid') && !input.placeId) {
    throw new Error('対面・ハイブリッド予定にはplaceIdが必要です')
  }
  assertExists(db, 'place', input.placeId, 'placeId')
  assertInteger(input.arrivalBufferMinutes, 'arrivalBufferMinutes', true)
  assertInteger(input.departureBufferMinutes, 'departureBufferMinutes', true)
  assertInteger(input.remoteSetupMinutes, 'remoteSetupMinutes', true)
  if ((input.decisionReason || '').length > 500) throw new Error('decisionReason は500文字以内です')
  return transaction(db, () => {
    const exists = Boolean(db.prepare(
      'SELECT appointment_id FROM appointment_mobility WHERE appointment_id = ?',
    ).get(input.appointmentId))
    db.prepare(
      'INSERT INTO appointment_mobility ' +
      '(appointment_id, attendance_mode, place_id, arrival_buffer_minutes, departure_buffer_minutes, ' +
      'remote_setup_minutes, mobility_status, decision_reason, source_ref, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(appointment_id) DO UPDATE SET attendance_mode = excluded.attendance_mode, ' +
      'place_id = excluded.place_id, arrival_buffer_minutes = excluded.arrival_buffer_minutes, ' +
      'departure_buffer_minutes = excluded.departure_buffer_minutes, remote_setup_minutes = excluded.remote_setup_minutes, ' +
      'mobility_status = excluded.mobility_status, decision_reason = excluded.decision_reason, ' +
      'source_ref = excluded.source_ref, updated_at = excluded.updated_at',
    ).run(
      input.appointmentId,
      input.attendanceMode,
      input.placeId ?? null,
      input.arrivalBufferMinutes ?? null,
      input.departureBufferMinutes ?? null,
      input.remoteSetupMinutes ?? null,
      status,
      input.decisionReason || '',
      input.sourceRef || '',
      new Date().toISOString(),
    )
    return { appointmentId: input.appointmentId, created: !exists }
  })
}

export function upsertRouteEstimate(
  db: DatabaseSync,
  input: RouteEstimateInput,
): { id: number; created: boolean } {
  ensurePlatformSchema(db)
  const sourceRef = input.sourceRef?.trim()
  const transportMode = input.transportMode || 'public_transit'
  if (!sourceRef) throw new Error('route.sourceRef は必須です')
  if (!TRANSPORT_MODES.has(transportMode)) throw new Error('route.transportMode が不正です')
  assertExists(db, 'place', input.fromPlaceId, 'fromPlaceId')
  assertExists(db, 'place', input.toPlaceId, 'toPlaceId')
  assertInteger(input.durationMinutes, 'durationMinutes')
  assertInteger(input.bufferMinutes ?? 0, 'bufferMinutes')
  if (input.validAt) assertIso(input.validAt, 'validAt')
  return transaction(db, () => {
    const current = db.prepare('SELECT id FROM route_estimate WHERE source_ref = ?')
      .get(sourceRef) as { id: number } | undefined
    const now = new Date().toISOString()
    if (current) {
      db.prepare(
        'UPDATE route_estimate SET from_place_id = ?, to_place_id = ?, transport_mode = ?, ' +
        'duration_minutes = ?, buffer_minutes = ?, provider = ?, valid_at = ?, updated_at = ? WHERE id = ?',
      ).run(
        input.fromPlaceId,
        input.toPlaceId,
        transportMode,
        input.durationMinutes,
        input.bufferMinutes || 0,
        input.provider || 'manual',
        input.validAt || '',
        now,
        current.id,
      )
      return { id: current.id, created: false }
    }
    const result = db.prepare(
      'INSERT INTO route_estimate ' +
      '(from_place_id, to_place_id, transport_mode, duration_minutes, buffer_minutes, provider, source_ref, valid_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.fromPlaceId,
      input.toPlaceId,
      transportMode,
      input.durationMinutes,
      input.bufferMinutes || 0,
      input.provider || 'manual',
      sourceRef,
      input.validAt || '',
      now,
    )
    return { id: Number(result.lastInsertRowid), created: true }
  })
}

export function addTravelSegment(
  db: DatabaseSync,
  input: TravelSegmentInput,
): { id: number; created: boolean } {
  ensurePlatformSchema(db)
  const sourceRef = input.sourceRef?.trim()
  const transportMode = input.transportMode || 'public_transit'
  const status = input.status || 'planned'
  if (!sourceRef) throw new Error('travel.sourceRef は必須です')
  if (!TRANSPORT_MODES.has(transportMode)) throw new Error('travel.transportMode が不正です')
  if (!TRAVEL_STATUSES.has(status)) throw new Error('travel.status が不正です')
  assertIso(input.departAt, 'departAt')
  assertIso(input.arriveAt, 'arriveAt')
  const depart = Date.parse(input.departAt)
  const arrive = Date.parse(input.arriveAt)
  if (arrive <= depart) throw new Error('arriveAt はdepartAtより後です')
  const computedDuration = Math.ceil((arrive - depart) / 60_000)
  if (input.durationMinutes !== undefined && Math.abs(input.durationMinutes - computedDuration) > 1) {
    throw new Error('durationMinutes がdepartAt/arriveAtと一致しません')
  }
  assertInteger(input.bufferMinutes ?? 0, 'bufferMinutes')
  assertInteger(input.costAmount, 'costAmount', true)
  assertExists(db, 'place', input.fromPlaceId, 'fromPlaceId')
  assertExists(db, 'place', input.toPlaceId, 'toPlaceId')
  assertExists(db, 'appointment', input.fromAppointmentId, 'fromAppointmentId')
  assertExists(db, 'appointment', input.toAppointmentId, 'toAppointmentId')
  return transaction(db, () => {
    const duplicate = db.prepare('SELECT id FROM travel_segment WHERE source_ref = ?')
      .get(sourceRef) as { id: number } | undefined
    if (duplicate) return { id: duplicate.id, created: false }
    const result = db.prepare(
      'INSERT INTO travel_segment ' +
      '(from_appointment_id, to_appointment_id, from_place_id, to_place_id, depart_at, arrive_at, ' +
      'transport_mode, provider, route_ref, duration_minutes, buffer_minutes, status, cost_amount, currency, ' +
      'reimbursable, calendar_external_id, source_ref, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.fromAppointmentId ?? null,
      input.toAppointmentId ?? null,
      input.fromPlaceId,
      input.toPlaceId,
      input.departAt,
      input.arriveAt,
      transportMode,
      input.provider || '',
      input.routeRef || '',
      computedDuration,
      input.bufferMinutes || 0,
      status,
      input.costAmount ?? null,
      input.currency || 'JPY',
      input.reimbursable ? 1 : 0,
      input.calendarExternalId || '',
      sourceRef,
      new Date().toISOString(),
    )
    return { id: Number(result.lastInsertRowid), created: true }
  })
}

/** ローカル運用・経路計算用。住所を含むためplatform snapshotへは接続しない。 */
export function listMobilityData(db: DatabaseSync): Record<string, unknown> {
  ensurePlatformSchema(db)
  const places = db.prepare(
    'SELECT id, place_key AS placeKey, name, kind, company_id AS companyId, address, latitude, longitude, ' +
    'timezone, provider, external_id AS externalId, privacy, source_ref AS sourceRef, updated_at AS updatedAt ' +
    'FROM place ORDER BY kind, name',
  ).all() as Record<string, unknown>[]
  const profile = db.prepare(
    'SELECT home_place_id AS homePlaceId, campus_place_id AS campusPlaceId, ' +
    'online_before_minutes AS onlineBeforeMinutes, online_after_minutes AS onlineAfterMinutes, ' +
    'in_person_before_minutes AS inPersonBeforeMinutes, in_person_after_minutes AS inPersonAfterMinutes, ' +
    'max_in_person_per_day AS maxInPersonPerDay, allow_online_in_transit AS allowOnlineInTransit, ' +
    'timezone, updated_at AS updatedAt FROM mobility_profile WHERE id = 1',
  ).get() as Record<string, unknown> | undefined
  const appointments = db.prepare(
    'SELECT am.appointment_id AS appointmentId, am.attendance_mode AS attendanceMode, am.place_id AS placeId, ' +
    'am.arrival_buffer_minutes AS arrivalBufferMinutes, am.departure_buffer_minutes AS departureBufferMinutes, ' +
    'am.remote_setup_minutes AS remoteSetupMinutes, am.mobility_status AS mobilityStatus, ' +
    'am.decision_reason AS decisionReason, am.source_ref AS sourceRef, am.updated_at AS updatedAt ' +
    'FROM appointment_mobility am ORDER BY am.updated_at DESC',
  ).all() as Record<string, unknown>[]
  const routes = db.prepare(
    'SELECT id, from_place_id AS fromPlaceId, to_place_id AS toPlaceId, transport_mode AS transportMode, ' +
    'duration_minutes AS durationMinutes, buffer_minutes AS bufferMinutes, provider, source_ref AS sourceRef, ' +
    'valid_at AS validAt, updated_at AS updatedAt FROM route_estimate ORDER BY updated_at DESC',
  ).all() as Record<string, unknown>[]
  const segments = db.prepare(
    'SELECT id, from_appointment_id AS fromAppointmentId, to_appointment_id AS toAppointmentId, ' +
    'from_place_id AS fromPlaceId, to_place_id AS toPlaceId, depart_at AS departAt, arrive_at AS arriveAt, ' +
    'transport_mode AS transportMode, provider, route_ref AS routeRef, duration_minutes AS durationMinutes, ' +
    'buffer_minutes AS bufferMinutes, status, cost_amount AS costAmount, currency, reimbursable, ' +
    'calendar_external_id AS calendarExternalId, source_ref AS sourceRef, updated_at AS updatedAt ' +
    'FROM travel_segment ORDER BY depart_at, id',
  ).all() as Record<string, unknown>[]
  return { places, profile: profile || null, appointments, routes, segments }
}
