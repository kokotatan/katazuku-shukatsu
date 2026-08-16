/**
 * 書き込み層(db-apply-calendar / db-apply-interview / inputs)の動作チェック(#6)。
 *
 * ここが一番繊細な層。「二度流しても1行に収束するか」「メール由来の粗い行を
 * カレンダー由来の確かな行が正しく昇格させるか」を、インメモリSQLiteで確かめる。
 * フィクスチャは実在名ではなく合成ラベル。
 *   npm run test:write-layer
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  openDb, upsertCompany, insertSelection, listAppointments, listEvents,
  addAppointment, findAppointmentMatch,
} from '../src/db.js'
import { upsertPerson, resolveSelectionId } from '../src/inputs.js'
import { applyCalendar } from '../src/db-apply-calendar.js'
import { applyInterview, savePersonPhoto } from '../src/db-apply-interview.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

const db: DatabaseSync = openDb(':memory:')
const companyId = upsertCompany(db, { name: '株式会社サンプルA' })
const selectionId = insertSelection(db, companyId, {
  company: '株式会社サンプルA', season: '夏', position: 'エンジニア', priority: 'A',
  status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '',
})

// --- findAppointmentMatch の優先順 ---
// 1) external_id 相当の完全一致 > 2) URL一致 > 3) 同時刻 という順で拾えること
addAppointment(db, {
  selectionId, at: '2026-09-01T10:00:00+09:00', kind: '面接', title: '一次面接',
  url: 'https://meet.example.com/aaa',
})
check('findAppointmentMatch: 同じ時刻・同じURLなら既存を拾う',
  findAppointmentMatch(db, { selectionId, at: '2026-09-01T10:00:00+09:00', title: '別名でも', url: 'https://meet.example.com/aaa', kind: '面接' }) !== undefined)
// 突合の優先順は タイトル → URL → 片方だけURL空。タイトルが一致するなら
// URLが違っても同じ会議とみなす(招待リンクの差し替えは実際よく起きる)。
check('findAppointmentMatch: タイトル一致はURL違いより優先される(リンク差し替え)',
  findAppointmentMatch(db, { selectionId, at: '2026-09-01T10:00:00+09:00', title: '一次面接', url: 'https://meet.example.com/bbb', kind: '面接' }) !== undefined)
check('findAppointmentMatch: タイトルもURLも違えば別会議として拾わない',
  findAppointmentMatch(db, { selectionId, at: '2026-09-01T10:00:00+09:00', title: '別の打ち合わせ', url: 'https://meet.example.com/bbb', kind: '面接' }) === undefined)
check('findAppointmentMatch: 時刻が空なら拾わない(突合の根拠が無い)',
  findAppointmentMatch(db, { selectionId, at: '', title: '一次面接', kind: '面接' }) === undefined)

// --- applyCalendar: 昇格(メール由来の粗い行 → カレンダー由来の確かな行) ---
const before = listAppointments(db).length
const promoted = applyCalendar({
  events: [{
    externalId: 'cal-1', title: '一次面接', startAt: '2026-09-01T10:00:00+09:00',
    endAt: '2026-09-01T11:00:00+09:00', company: '株式会社サンプルA', position: 'エンジニア',
    url: 'https://meet.example.com/aaa', location: '', kind: '面接',
  }],
}, db)
check('applyCalendar: メール由来の予定に合流し、行を増やさない',
  listAppointments(db).length === before, `${before} → ${listAppointments(db).length}`)
check('applyCalendar: 合流を promoted として数える', promoted.promoted + promoted.updated >= 1)
const merged = listAppointments(db).find((a) => a.at.startsWith('2026-09-01'))!
check('applyCalendar: 空欄だった終了時刻が埋まる', merged.endAt !== '')
check('applyCalendar: external_id が刻まれ、次回の突合キーになる',
  (db.prepare('SELECT external_id FROM appointment WHERE id = ?').get(merged.id) as { external_id: string }).external_id === 'cal-1')

// --- applyCalendar: 二度流しても増えない・変わらない ---
const again = applyCalendar({
  events: [{
    externalId: 'cal-1', title: '一次面接', startAt: '2026-09-01T10:00:00+09:00',
    endAt: '2026-09-01T11:00:00+09:00', company: '株式会社サンプルA', position: 'エンジニア',
    url: 'https://meet.example.com/aaa', location: '', kind: '面接',
  }],
}, db)
check('applyCalendar: 同じ入力の再実行は unchanged', again.unchanged === 1 && again.created === 0)
check('applyCalendar: 再実行で行が増えない', listAppointments(db).length === before)

// --- applyCalendar: 内容が変わったら更新する ---
const changed = applyCalendar({
  events: [{
    externalId: 'cal-1', title: '一次面接(オンラインへ変更)', startAt: '2026-09-01T10:00:00+09:00',
    endAt: '2026-09-01T11:00:00+09:00', company: '株式会社サンプルA', position: 'エンジニア',
    url: 'https://meet.example.com/aaa', location: '', kind: '面接',
  }],
}, db)
check('applyCalendar: 内容が変われば updated', changed.updated === 1)
check('applyCalendar: 変更は行を増やさない', listAppointments(db).length === before)

// --- applyCalendar: 別の externalId は別の予定 ---
applyCalendar({
  events: [{
    externalId: 'cal-2', title: '二次面接', startAt: '2026-09-08T14:00:00+09:00',
    company: '株式会社サンプルA', position: 'エンジニア', kind: '面接',
  }],
}, db)
check('applyCalendar: 別イベントは別の行として増える', listAppointments(db).length === before + 1)

// --- upsertPerson: 敬称と包含の名寄せ ---
const p1 = upsertPerson(db, { name: '面接官A', company: '株式会社サンプルA', role: '採用担当' })
const p2 = upsertPerson(db, { name: '面接官Aさん', company: 'サンプルA' })
check('upsertPerson: 敬称違い・法人格違いでも同一人物', p1 === p2)
const p3 = upsertPerson(db, { name: '面接官A', company: '株式会社サンプルB' })
check('upsertPerson: 会社が違えば別人', p3 !== p1)
const p4 = upsertPerson(db, { name: 'B', company: '株式会社サンプルA' })
const p5 = upsertPerson(db, { name: 'Bさん', company: '株式会社サンプルA' })
check('upsertPerson: 1文字の名前でも敬称だけの差なら同一', p4 === p5)
const p6 = upsertPerson(db, { name: 'BC', company: '株式会社サンプルA' })
check('upsertPerson: 短い名前の包含は別人に倒す(B ≠ BC)', p6 !== p4)
check('upsertPerson: 名前が空なら拒否する', (() => {
  try { upsertPerson(db, { name: '  ' }); return false } catch { return true }
})())
const filled = db.prepare('SELECT role FROM person WHERE id = ?').get(p1) as { role: string }
check('upsertPerson: 既存の値を後の空欄で潰さない', filled.role === '採用担当')

// --- resolveSelectionId ---
const resolved = resolveSelectionId(db, 'サンプルA', 'エンジニア')
check('resolveSelectionId: 法人格違いでも既存トラックへ解決する', resolved.selectionId === selectionId)

// --- applyInterview: 冪等・人物・候補・イベント ---
const photoRoot = mkdtempSync(join(tmpdir(), 'katazuku-photo-'))
const first = applyInterview({
  runId: 'run-1', company: '株式会社サンプルA', position: 'エンジニア',
  occurredAt: '2026-09-01T10:00:00+09:00', title: '一次面接', summary: '（要約）',
  people: [{ name: '面接官A', role: '採用担当', notes: ['（メモ）'] }],
  profileSuggestions: [{ field: 'careerAxis', value: '（軸）', confidence: 0.9 }],
}, db, photoRoot)
check('applyInterview: 新規は created', first.created)
const second = applyInterview({
  runId: 'run-1', company: '株式会社サンプルA', position: 'エンジニア',
  occurredAt: '2026-09-01T10:00:00+09:00', title: '一次面接', summary: '（要約）',
}, db, photoRoot)
check('applyInterview: 同じ runId の再実行は作らない',
  !second.created && second.interviewId === first.interviewId)
check('applyInterview: 面接記録は1行', (db.prepare('SELECT COUNT(*) AS n FROM interview_note').get() as { n: number }).n === 1)
check('applyInterview: 人物メモが1件だけ積まれる',
  (db.prepare('SELECT COUNT(*) AS n FROM person_note').get() as { n: number }).n === 1)
check('applyInterview: プロフィール候補が積まれる',
  (db.prepare('SELECT COUNT(*) AS n FROM profile_suggestion').get() as { n: number }).n === 1)
check('applyInterview: イベント台帳に「面接記録」が残る',
  listEvents(db, selectionId).some((e) => e.kind === '面接記録'))

// --- savePersonPhoto ---
const imagePath = join(photoRoot, 'face.png')
writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'))
const key = savePersonPhoto(db, p1, imagePath, photoRoot)
check('savePersonPhoto: storage_key を返す', key === `people/person-${p1}.png`)
check('savePersonPhoto: 既に写真がある人物は上書きしない(空を返す)',
  savePersonPhoto(db, p1, imagePath, photoRoot) === '')
check('savePersonPhoto: DBに持つのは鍵とハッシュだけ(本体は持たない)', (() => {
  const row = db.prepare('SELECT storage_key, sha256 FROM person_photo WHERE person_id = ?').get(p1) as { storage_key: string; sha256: string }
  return row.storage_key === key && row.sha256.length === 64
})())
check('savePersonPhoto: 未対応の拡張子は拒否する', (() => {
  const bad = join(photoRoot, 'face.bmp')
  writeFileSync(bad, 'x')
  try { savePersonPhoto(db, p4, bad, photoRoot); return false } catch { return true }
})())

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
