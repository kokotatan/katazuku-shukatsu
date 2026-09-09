import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, upsertCompany, insertSelection, addAppointment } from '../src/db'
import { evaluateMeetingPreparation, saveMeetingPreparation, meetingPreparationSnapshot, moveMeetingPreparation, type PreparationInput } from '../src/meeting-preparation'
import { listPlatformSnapshot } from '../src/platform'

const db = openDb(':memory:')
const now = new Date('2026-09-09T09:00:00Z')
const companyId = upsertCompany(db, { name: '準備検証株式会社' })
const selection = (position: string) => insertSelection(db, companyId, {
  company: '準備検証株式会社', position, season: '', priority: '', status: '選考中', steps: [], nextAction: '', nextDate: '', submitted: false, esUrl: '', memo: '',
})
const selectionId = selection('エンジニア')
const otherTrack = selection('ビジネス')
const id = addAppointment(db, { selectionId, at: '2026-09-17T14:30:00+09:00', kind: '面談', title: 'VPoE面談', person: '担当者' }).id
const id2 = addAppointment(db, { selectionId: otherTrack, at: '2026-09-17T06:00:00Z', kind: '面接', title: '一次面接' }).id
addAppointment(db, { selectionId, at: '2026-09-18T10:00:00+09:00', kind: 'テスト', title: '適性検査' })
addAppointment(db, { selectionId, at: '2026-09-08T14:30:00+09:00', kind: '面談', title: '過去' })
const target = () => evaluateMeetingPreparation(db, now).find(a => a.appointmentId === id)!
assert.equal(evaluateMeetingPreparation(db, now).length, 2, '8日後でも対象。過去・代行不可のテストは対象外')
assert.equal(evaluateMeetingPreparation(db, now)[0].appointmentId, id, 'UTCと日本時刻が混ざっても実際の時刻順に準備する')
assert.equal(target().status, 'pending')
assert.equal(target().dossier, null)
const make = (): PreparationInput => ({
  appointmentId: id, contextHash: target().contextHash, preparedAt: now.toISOString(), sourceRef: 'test:prep',
  summary: '面談で職種と期待を確認する', counterpartResearch: '相手の公式プロフィールを確認', priorContext: '前回記録を確認',
  questionsToAsk: ['顧客課題は', '担当範囲は', '期待する成果は'],
  anticipatedQuestions: [1, 2, 3].map(n => ({ question: `質問${n}`, answerOutline: `本人の事実${n}`, evidenceRef: 'private/file.local.md' })),
  sources: [{ title: '公式情報', url: 'https://example.com/recruit' }], unknowns: ['配属先は面談で確認'],
})
assert.throws(() => saveMeetingPreparation(db, make(), now), /企業研究/, '成果物だけ書いても企業研究なしではreadyにできない')
db.prepare(`INSERT INTO company_dossier (company_id, summary, sources_json, researched_at, source_ref)
  VALUES (?, '事業の確認済み要約', ?, ?, 'test:research')`).run(companyId, JSON.stringify(make().sources), now.toISOString())
const prep = make()
assert.throws(() => saveMeetingPreparation(db, { ...prep, questionsToAsk: [] }, now), /逆質問/)
assert.throws(() => saveMeetingPreparation(db, { ...prep, sources: [{ title: '偽URL', url: 'javascript:alert(1)' }] }, now), /一次情報/)
assert.throws(() => saveMeetingPreparation(db, { ...prep, preparedAt: '2030-01-01T00:00:00Z' }, now), /未来/)
saveMeetingPreparation(db, prep, now)
saveMeetingPreparation(db, prep, now)
assert.equal(target().status, 'ready')
assert.equal((db.prepare('SELECT COUNT(*) n FROM appointment_preparation').get() as any).n, 1, '同一予定の再保存で増殖しない')
assert.equal(evaluateMeetingPreparation(db, now).find(a => a.appointmentId === id2)!.status, 'pending', '別トラックは別の準備を要求')
const before = target().contextHash
db.prepare("UPDATE appointment SET person='別の相手' WHERE id=?").run(id)
assert.notEqual(target().contextHash, before)
assert.equal(target().status, 'pending')
assert.throws(() => saveMeetingPreparation(db, prep, now), /根拠が変わり/, '作成中に相手が変わると旧成果物を拒否')
saveMeetingPreparation(db, make(), now)
db.prepare("UPDATE selection SET status='二次面接' WHERE id=?").run(selectionId)
assert.equal(target().status, 'pending', '選考段階が変われば再確認')
saveMeetingPreparation(db, make(), now)
db.prepare("UPDATE appointment SET at='2026-09-16T14:30:00+09:00' WHERE id=?").run(id)
assert.equal(target().status, 'pending', '日時変更で再確認')
saveMeetingPreparation(db, make(), now)
const finalCheck = evaluateMeetingPreparation(db, new Date('2026-09-15T09:00:00Z')).find(a => a.appointmentId === id)!
assert.ok(finalCheck.reasons.some(r => r.includes('最終確認')), '初回準備済みでも48時間以内で最新情報を確認')
db.prepare("UPDATE company_dossier SET researched_at='2026-07-01T00:00:00Z' WHERE company_id=?").run(companyId)
assert.ok(target().reasons.some(r => r.startsWith('企業研究')), '古い企業研究をそのまま使わない')
db.prepare('UPDATE company_dossier SET researched_at=? WHERE company_id=?').run(now.toISOString(), companyId)
saveMeetingPreparation(db, make(), now)
db.prepare("UPDATE appointment_preparation SET status='blocked', blocker='通信障害' WHERE appointment_id=?").run(id)
assert.equal(target().status, 'pending')
assert.ok(target().reasons.some(r => r.includes('通信障害')), '障害後も消えず再処理可能')
saveMeetingPreparation(db, make(), now)
assert.equal(target().status, 'ready')
const originalRole = process.env.KATAZUKU_DB_ROLE
process.env.KATAZUKU_DB_ROLE = 'replica'
assert.throws(() => saveMeetingPreparation(db, make(), now), /正本DB/)
if (originalRole === undefined) delete process.env.KATAZUKU_DB_ROLE
else process.env.KATAZUKU_DB_ROLE = originalRole
db.prepare("UPDATE appointment SET status='中止' WHERE id=?").run(id2)
assert.equal(evaluateMeetingPreparation(db, now).length, 1, '取消済みは準備待ちに残さない')
const projection = meetingPreparationSnapshot(db, now)
assert.equal(projection.length, 1)
assert.equal(projection[0].status, 'ready')
assert.equal(projection[0].summary, make().summary)
assert.ok(!JSON.stringify(projection).includes('private/file.local.md'), 'snapshotへローカル証拠パスを出さない')
assert.ok(Array.isArray(listPlatformSnapshot(db).meetingPreparations), '同じsnapshotからアプリに配信')
db.prepare("UPDATE appointment SET status='予定' WHERE id=?").run(id2)
moveMeetingPreparation(db, id, id2)
db.prepare('DELETE FROM appointment WHERE id=?').run(id)
assert.equal((db.prepare('SELECT source_ref FROM appointment_preparation WHERE appointment_id=?').get(id2) as any).source_ref, 'test:prep', '予定の統合時に外部キー制約で失敗せず出典を保持')
assert.equal(evaluateMeetingPreparation(db, now).find(a => a.appointmentId === id2)!.status, 'pending', '統合元の準備を新しい予定の完了と誤認しない')
db.close()
if (process.platform === 'win32') {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const paths = ['meeting-preparation-guard.ps1', 'tsx-command.ps1', 'katazuku-role.ps1', 'asa-auto.ps1', 'evening-brief.ps1', 'calendar-sync.ps1']
    .map(name => `'${resolve(root, 'scripts', name).replace(/'/g, "''")}'`).join(',')
  const script = `$ErrorActionPreference='Stop'; foreach($path in @(${paths})) { $errors=$null; $tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors) | Out-Null; if($errors.Count) { throw ($errors | Out-String) } }`
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(ps.status, 0, `定期タスクと同じWindows PowerShellでパースできること: ${ps.stderr}`)
}
console.log('面談準備: 検知・トラック分離・成果物検証・冪等・変更・鮮度・再試行・正本・snapshotのチェック成功')
