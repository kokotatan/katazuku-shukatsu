/**
 * ボード(examples/board)が読む JSON スナップショットを、正本DBから書き出す。
 *
 * ボードは「見る窓」なので、DBへ触らず1枚のJSONだけを読む。サーバも要らない。
 *
 *   npm run board:snapshot            # data/katazuku.db(または $KATAZUKU_DB)から
 *   npm run board:snapshot -- ./x.db  # DBを指定して
 *   npm run board:demo                # 架空データのデモ版を書き出す(リポジトリに同梱するのはこちら)
 *
 * 実データから書き出した snapshot.json は .gitignore 済み。コミットしないこと。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  openDb, upsertCompany, insertSelection, addAppointment, addPending,
  listSelections, listAppointments, listPending, outcomeOf,
} from '../src/db.js'
import { upsertMailItem, listActionableMail } from '../src/platform.js'
import type { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))

export interface BoardSnapshot {
  generatedAt: string
  demo: boolean
  selections: {
    id: number
    company: string
    season: string
    position: string
    priority: string
    status: string
    outcome: string
    nextAction: string
    nextDate: string
    submitted: boolean
    steps: string[]
  }[]
  appointments: { id: number; company: string; at: string; endAt: string; kind: string; title: string; hasUrl: boolean; location: string; status: string }[]
  pending: { name: string; context: string; createdAt: string }[]
  mail: { id: string; company: string | null; subject: string; summary: string; category: string; deadline: string; receivedAt: string }[]
}

export function buildSnapshot(db: DatabaseSync, demo: boolean): BoardSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    demo,
    selections: listSelections(db).map((s) => ({
      id: s.id, company: s.company, season: s.season, position: s.position, priority: s.priority,
      status: s.status, outcome: outcomeOf(s.status), nextAction: s.nextAction, nextDate: s.nextDate,
      submitted: s.submitted, steps: s.steps,
    })),
    // 会議URLは「見る窓」には出さない(参加リンクは正本DBとカレンダーにあれば足りる)
    appointments: listAppointments(db).map((a) => ({
      id: a.id, company: a.company, at: a.at, endAt: a.endAt, kind: a.kind,
      title: a.title, hasUrl: a.url !== '', location: a.location, status: a.status,
    })),
    pending: listPending(db).map((p) => ({ name: p.name, context: p.context, createdAt: p.created_at })),
    mail: listActionableMail(db).map((m) => ({
      id: String(m.id), company: (m.company as string) ?? null, subject: String(m.subject),
      summary: String(m.summary ?? ''), category: String(m.category ?? ''),
      deadline: String(m.deadline ?? ''), receivedAt: String(m.receivedAt),
    })),
  }
}

/** 架空データだけでボードを一通り埋める。実在の企業・人物は登場しない */
function seedDemo(db: DatabaseSync): void {
  const rows: { company: string; industry: string; season: string; position: string; priority: string; status: string; next: string; date: string; steps: string[]; submitted: boolean }[] = [
    { company: '株式会社アルファ', industry: 'SaaS', season: '本選考', position: 'ソフトウェアエンジニア', priority: 'A', status: '最終面接済', next: '結果待ち', date: '2026-08-21', steps: ['ES', '適性検査', '一次面接', '最終面接'], submitted: true },
    { company: 'ベータ工業株式会社', industry: '製造', season: '夏', position: '技術総合職', priority: 'B', status: '一次面接済', next: '二次面接の日程調整', date: '2026-08-19', steps: ['ES', '一次面接'], submitted: true },
    { company: '合同会社ガンマ', industry: 'コンサル', season: '本選考', position: 'ビジネスコンサルタント', priority: 'B', status: '出願済', next: '適性検査を受ける', date: '2026-08-18', steps: ['ES'], submitted: true },
    { company: 'Delta Systems Inc.', industry: 'SIer', season: '冬', position: 'データエンジニア', priority: 'C', status: '出願予定', next: 'ESを書く', date: '2026-08-25', steps: [], submitted: false },
    { company: '株式会社イプシロン', industry: 'Web', season: '夏', position: 'プロダクトデザイナー', priority: 'A', status: '内定', next: '承諾期限までに返答', date: '2026-08-28', steps: ['ES', '一次面接', '最終面接'], submitted: true },
    { company: 'ゼータ商事株式会社', industry: '商社', season: '本選考', position: '総合職', priority: 'C', status: '不合格', next: '', date: '', steps: ['ES', '一次面接'], submitted: true },
    { company: '株式会社イータ', industry: 'ヘルスケア', season: '夏', position: 'エンジニア', priority: 'B', status: '辞退', next: '', date: '', steps: ['ES'], submitted: true },
  ]

  for (const r of rows) {
    const id = upsertCompany(db, { name: r.company, industry: r.industry })
    insertSelection(db, id, {
      company: r.company, season: r.season, position: r.position, priority: r.priority,
      status: r.status, steps: r.steps, nextAction: r.next, nextDate: r.date,
      submitted: r.submitted, esUrl: '', memo: '',
    })
  }

  const byCompany = new Map(listSelections(db).map((s) => [s.company, s.id]))
  const appts: [string, string, string, string, string, string][] = [
    ['株式会社アルファ', '2026-08-21T10:00:00+09:00', '2026-08-21T11:00:00+09:00', '面接', '最終結果の連絡面談', ''],
    ['ベータ工業株式会社', '2026-08-19T15:00:00+09:00', '2026-08-19T16:00:00+09:00', '面接', '二次面接', '（本社・対面）'],
    ['合同会社ガンマ', '2026-08-18T23:59:00+09:00', '', '締切', '適性検査の受検期限', ''],
    ['株式会社イプシロン', '2026-08-28T12:00:00+09:00', '', '締切', '内定承諾の回答期限', ''],
    ['Delta Systems Inc.', '2026-08-25T23:59:00+09:00', '', '締切', 'ES提出期限', ''],
  ]
  for (const [company, at, endAt, kind, title, location] of appts) {
    const selectionId = byCompany.get(company)
    if (selectionId === undefined) continue
    addAppointment(db, { selectionId, at, endAt, kind, title, location, url: kind === '面接' && !location ? 'https://example.com/meeting' : '' })
  }

  // 名寄せが怪しかった入力(法人格違い)。ボードの「要確認」に出る
  addPending(db, '株式会社ガンマ', '既存「合同会社ガンマ」と紛らわしい。同一なら別名として学習、別会社ならこのままでよい')

  const mails: [string, string, string, string, string, string][] = [
    ['demo-1', '株式会社アルファ', '最終面接の結果について', '結果連絡の面談日程が案内されている', '選考案内', '2026-08-20'],
    ['demo-2', 'ベータ工業株式会社', '二次面接の日程調整のお願い', '候補日3つから選んで返信が必要', '日程調整', '2026-08-18'],
    ['demo-3', '株式会社イプシロン', '内定のご連絡と承諾期限', '承諾書の提出期限が案内されている', '内定', '2026-08-28'],
    ['demo-4', '', '合同説明会のご案内', '任意参加のイベント案内', 'その他', ''],
  ]
  const companyIds = new Map(rows.map((r) => [r.company, upsertCompany(db, { name: r.company })]))
  for (const [id, company, subject, summary, category, deadline] of mails) {
    upsertMailItem(db, {
      id, companyId: company ? companyIds.get(company) : null, receivedAt: '2026-08-16T08:00:00+09:00',
      sender: 'noreply@example.com', subject, summary, category, needsAction: true, deadline,
    })
  }
}

function main(): void {
  const demo = process.argv.includes('--demo')
  const dbPath = demo
    ? ':memory:'
    : (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.KATAZUKU_DB ?? 'data/katazuku.db')
  const db = openDb(dbPath)
  if (demo) seedDemo(db)

  const out = join(here, 'board', 'public', demo ? 'snapshot.demo.json' : 'snapshot.json')
  mkdirSync(dirname(out), { recursive: true })
  const snapshot = buildSnapshot(db, demo)
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  db.close()

  console.log(`${out} に書き出しました`)
  console.log(`  選考 ${snapshot.selections.length} / 予定 ${snapshot.appointments.length} / 要確認 ${snapshot.pending.length} / 要対応メール ${snapshot.mail.length}`)
  if (!demo) console.log('  ※ 実データを含みます。snapshot.json はコミットしないでください(.gitignore 済み)')
}

main()
