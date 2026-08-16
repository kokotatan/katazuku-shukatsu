/**
 * 場所・参加形態・経路見積もり・確定移動と、住所のsnapshot分離を検証する。
 */
import { addAppointment, insertSelection, openDb, upsertCompany } from '../src/db.js'
import {
  addTravelSegment,
  listMobilityData,
  setAppointmentMobility,
  setMobilityProfile,
  upsertPlace,
  upsertRouteEstimate,
} from '../src/mobility.js'
import { listPlatformSnapshot } from '../src/platform.js'

const db = openDb(':memory:')
let passed = 0
let failed = 0

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function check(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log('[OK] ' + name)
  } catch (error) {
    failed += 1
    console.error('[NG] ' + name + ': ' + (error as Error).message)
  }
}

function expectThrow(fn: () => unknown, pattern: RegExp): void {
  try {
    fn()
  } catch (error) {
    if (pattern.test((error as Error).message)) return
    throw error
  }
  throw new Error('例外が発生しませんでした')
}

check('移動用の5テーブルが初期化される', () => {
  for (const table of ['place', 'mobility_profile', 'appointment_mobility', 'route_estimate', 'travel_segment']) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    assert(row, table + ' がありません')
  }
})

const companyId = upsertCompany(db, {
  name: '移動テスト株式会社',
  shortName: '移動テスト',
  industry: 'IT',
  mypageUrl: '',
  loginId: '',
  password: '',
  memo: '',
})
const selectionId = insertSelection(db, companyId, {
  company: '移動テスト株式会社',
  season: '28卒本選考',
  position: '開発職',
  priority: '',
  status: '選考中',
  steps: [],
  nextAction: '対面面接',
  nextDate: '2026-08-10',
  submitted: true,
  esUrl: '',
  memo: '',
})
const appointmentId = addAppointment(db, {
  selectionId,
  at: '2026-08-10T14:00:00+09:00',
  endAt: '2026-08-10T15:00:00+09:00',
  kind: '面接',
  title: '東京オフィス一次面接',
  location: '東京都内',
  status: '予定',
}).id

const home = upsertPlace(db, {
  key: 'home',
  name: '自宅',
  kind: 'home',
  address: '非公開テスト住所',
  latitude: 38.2601,
  longitude: 140.8824,
  privacy: 'private',
  sourceRef: 'test:place:home',
})
const campus = upsertPlace(db, {
  key: 'campus',
  name: '大学',
  kind: 'campus',
  privacy: 'private',
  sourceRef: 'test:place:campus',
})
const office = upsertPlace(db, {
  key: 'company:mobility-test:tokyo',
  name: '東京オフィス',
  kind: 'office',
  companyId,
  address: '東京都テスト区',
  privacy: 'shared',
  sourceRef: 'test:place:office',
})

check('場所を種類・公開範囲つきで保存する', () => {
  assert(home.created && campus.created && office.created, '場所が作成されていません')
  const row = db.prepare('SELECT kind, privacy FROM place WHERE id = ?').get(home.id) as {
    kind: string
    privacy: string
  }
  assert(row.kind === 'home' && row.privacy === 'private', '場所属性が不正です')
})

check('同じplace keyは重複せず、未指定の住所を保持する', () => {
  const repeated = upsertPlace(db, { key: 'home', name: '自宅（更新）' })
  assert(!repeated.created && repeated.id === home.id, '場所が重複しました')
  const row = db.prepare('SELECT name, address FROM place WHERE id = ?').get(home.id) as {
    name: string
    address: string
  }
  assert(row.name === '自宅（更新）' && row.address === '非公開テスト住所', '未指定の住所が消えました')
})

check('移動プロファイルを部分更新できる', () => {
  setMobilityProfile(db, {
    homePlaceId: home.id,
    campusPlaceId: campus.id,
    onlineBeforeMinutes: 20,
    inPersonBeforeMinutes: 45,
    maxInPersonPerDay: 2,
  })
  const updated = setMobilityProfile(db, { allowOnlineInTransit: false })
  assert(updated.homePlaceId === home.id && updated.onlineBeforeMinutes === 20, '部分更新で既存設定が消えました')
  assert(updated.allowOnlineInTransit === 0, '移動中オンライン設定が不正です')
})

check('負の余裕時間を拒否する', () => {
  expectThrow(() => setMobilityProfile(db, { onlineBeforeMinutes: -1 }), /0以上の整数/)
})

check('対面予定は場所なしで確定できない', () => {
  expectThrow(() => setAppointmentMobility(db, {
    appointmentId,
    attendanceMode: 'in_person',
  }), /placeIdが必要/)
})

check('対面予定へ場所と余裕時間を付ける', () => {
  const result = setAppointmentMobility(db, {
    appointmentId,
    attendanceMode: 'in_person',
    placeId: office.id,
    arrivalBufferMinutes: 30,
    departureBufferMinutes: 20,
    mobilityStatus: 'confirmed',
    decisionReason: '前後の移動時間を確保済み',
    sourceRef: 'test:appointment-mobility:001',
  })
  assert(result.created, 'appointment_mobilityが作成されていません')
  const repeated = setAppointmentMobility(db, {
    appointmentId,
    attendanceMode: 'in_person',
    placeId: office.id,
    mobilityStatus: 'feasible',
  })
  assert(!repeated.created, '同じ予定のmobilityが重複しました')
})

let routeId = 0
check('経路見積もりを冪等upsertする', () => {
  const route = upsertRouteEstimate(db, {
    fromPlaceId: home.id,
    toPlaceId: office.id,
    transportMode: 'rail',
    durationMinutes: 150,
    bufferMinutes: 30,
    provider: 'manual',
    sourceRef: 'test:route:home-tokyo',
  })
  routeId = route.id
  assert(route.created, '経路が作成されていません')
  const updated = upsertRouteEstimate(db, {
    fromPlaceId: home.id,
    toPlaceId: office.id,
    transportMode: 'rail',
    durationMinutes: 160,
    bufferMinutes: 30,
    provider: 'route-adapter',
    sourceRef: 'test:route:home-tokyo',
  })
  assert(!updated.created && updated.id === routeId, '経路が重複しました')
  const row = db.prepare('SELECT duration_minutes AS duration FROM route_estimate WHERE id = ?')
    .get(routeId) as { duration: number }
  assert(row.duration === 160, '経路見積もりが更新されていません')
})

check('存在しない場所の経路を拒否する', () => {
  expectThrow(() => upsertRouteEstimate(db, {
    fromPlaceId: 9999,
    toPlaceId: office.id,
    durationMinutes: 10,
    sourceRef: 'test:route:invalid',
  }), /見つかりません/)
})

check('到着が出発以前の移動を拒否する', () => {
  expectThrow(() => addTravelSegment(db, {
    fromPlaceId: home.id,
    toPlaceId: office.id,
    departAt: '2026-08-10T12:00:00+09:00',
    arriveAt: '2026-08-10T11:00:00+09:00',
    sourceRef: 'test:travel:invalid-time',
  }), /arriveAt.*departAt/)
})

let segmentId = 0
check('確定移動を予定と結び、所要時間を日時から算出する', () => {
  const segment = addTravelSegment(db, {
    toAppointmentId: appointmentId,
    fromPlaceId: home.id,
    toPlaceId: office.id,
    departAt: '2026-08-10T10:30:00+09:00',
    arriveAt: '2026-08-10T13:30:00+09:00',
    transportMode: 'rail',
    bufferMinutes: 30,
    status: 'reserved',
    costAmount: 22000,
    reimbursable: true,
    sourceRef: 'test:travel:001',
  })
  segmentId = segment.id
  assert(segment.created, '移動区間が作成されていません')
  const row = db.prepare(
    'SELECT duration_minutes AS duration, reimbursable, to_appointment_id AS appointmentId ' +
    'FROM travel_segment WHERE id = ?',
  ).get(segmentId) as { duration: number; reimbursable: number; appointmentId: number }
  assert(row.duration === 180 && row.reimbursable === 1 && row.appointmentId === appointmentId, '移動区間が不正です')
})

check('同じsourceRefの移動を二重作成しない', () => {
  const duplicate = addTravelSegment(db, {
    toAppointmentId: appointmentId,
    fromPlaceId: home.id,
    toPlaceId: office.id,
    departAt: '2026-08-10T10:30:00+09:00',
    arriveAt: '2026-08-10T13:30:00+09:00',
    sourceRef: 'test:travel:001',
  })
  assert(!duplicate.created && duplicate.id === segmentId, '移動区間が重複しました')
})

check('SQLite制約でも不正な参加形態を拒否する', () => {
  expectThrow(() => db.prepare(
    'UPDATE appointment_mobility SET attendance_mode = ? WHERE appointment_id = ?',
  ).run('teleport', appointmentId), /CHECK constraint/)
})

check('ローカル一覧は場所・経路・移動をまとめて返す', () => {
  const data = listMobilityData(db) as {
    places: unknown[]
    routes: unknown[]
    segments: unknown[]
  }
  assert(data.places.length === 3 && data.routes.length === 1 && data.segments.length === 1, '移動一覧が不正です')
})

check('住所と移動履歴をplatform snapshotへ出さない', () => {
  const snapshot = JSON.stringify(listPlatformSnapshot(db))
  assert(!snapshot.includes('非公開テスト住所'), '住所がsnapshotへ漏れています')
  assert(!snapshot.includes('test:travel:001'), '移動履歴がsnapshotへ漏れています')
})

db.close()
console.log('移動DBテスト: ' + passed + '件成功 / ' + failed + '件失敗')
if (failed > 0) process.exit(1)
