/**
 * 匿名seed: 架空の企業・選考・面接予定だけで正本DBを組み立てるデモ。
 * 実在の企業・人物は一切含まない。
 *
 *   npm run seed            # :memory: に組み立てて内容を表示
 *   npm run seed -- ./demo.db   # ファイルに書き出して中身を確認できる
 */
import { openDb, upsertCompany, insertSelection, addAppointment, listSelections, listCompanies } from '../src/db'

const path = process.argv[2] ?? ':memory:'
const db = openDb(path)

// 架空企業(すべてダミー)
const acme = upsertCompany(db, { name: 'アクメ製作所', officialName: 'アクメ製作所株式会社', industry: '製造' })
const globex = upsertCompany(db, { name: 'グローベックス', officialName: 'グローベックス株式会社', industry: 'IT' })
const initech = upsertCompany(db, { name: 'イニテック', industry: 'コンサル' })

insertSelection(db, acme, {
  company: 'アクメ製作所', season: '本選考', position: '総合職',
  priority: 'A', status: '一次面接済(6/20)', steps: ['ES', '適性', '一次面接'],
  nextAction: '二次面接の日程調整', nextDate: '2026-07-05',
  submitted: true, esUrl: '', memo: '架空データ',
})
insertSelection(db, globex, {
  company: 'グローベックス', season: '夏', position: 'エンジニア',
  priority: 'B', status: 'エントリー済', steps: ['ES'],
  nextAction: 'Web適性の受験(本人)', nextDate: '2026-06-28',
  submitted: true, esUrl: '', memo: '架空データ',
})
insertSelection(db, initech, {
  company: 'イニテック', season: '本選考', position: '総合職',
  priority: 'C', status: 'スカウト受信', steps: [],
  nextAction: '応募可否の判断', nextDate: '', submitted: false, esUrl: '', memo: '架空データ',
})

const sel = listSelections(db).find(s => s.company === 'アクメ製作所')!
addAppointment(db, {
  selectionId: sel.id, at: '2026-07-05T14:00:00+09:00', endAt: '2026-07-05T15:00:00+09:00',
  kind: 'interview', title: '二次面接', url: 'https://example.com/meet/xxxx', person: '担当者A',
})

console.log(`企業 ${listCompanies(db).length} 社 / 選考 ${listSelections(db).length} 件を組み立てました`)
for (const s of listSelections(db)) {
  console.log(`- ${s.company}（${s.season}・${s.position}）: ${s.status} → ${s.nextAction || '—'} ${s.nextDate || ''}`)
}
if (path !== ':memory:') console.log(`\n${path} に書き出しました。`)
