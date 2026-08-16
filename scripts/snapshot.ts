/**
 * アプリ群(board/...)が読む JSON スナップショットを、正本DBから書き出す。
 *
 * 形は本体が `/api/data` で配っているものと同じ(`shared/src/index.ts` の `KatazukuData`)。
 * アプリは「見る窓」なのでDBへ触らず、この1枚だけを読む。サーバも要らない。
 *
 *   npm run snapshot              # data/katazuku.db(または $KATAZUKU_DB)から
 *   npm run snapshot -- ./x.db    # DBを指定して
 *   npm run snapshot -- --demo    # 架空データのデモ版(リポジトリに同梱するのはこちら)
 *
 * 出さないもの: マイページのログインIDとパスワード、顔写真の実体、メール本文。
 * 実データから書き出した snapshot.json は .gitignore 済み。コミットしないこと。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  openDb, upsertCompany, insertSelection, addAppointment, addEvent, addPending,
  listSelections, listAppointments, listCompanies, listEvents, listPending, outcomeOf,
} from '../src/db.js'
import { listPlatformSnapshot, upsertCompanyDossier, upsertMailItem } from '../src/platform.js'
import { upsertPerson } from '../src/inputs.js'
import type { DatabaseSync } from 'node:sqlite'

const here = dirname(fileURLToPath(import.meta.url))

/** アプリが読む配置先。アプリを増やしたらここに足す */
const TARGETS = ['board']

export function buildSnapshot(db: DatabaseSync, demo: boolean): Record<string, unknown> {
  const selections = listSelections(db)
  const companyOf = new Map(selections.map((s) => [s.id, s.company]))
  const platform = listPlatformSnapshot(db)

  return {
    generatedAt: new Date().toISOString(),
    demo,
    // ログインID・パスワードは意図的に出さない(見る窓に認証情報は要らない)
    companies: listCompanies(db).map((c) => ({
      name: c.name, shortName: c.shortName ?? '', industry: c.industry,
      mypageUrl: c.mypageUrl, memo: c.memo,
    })),
    selections: selections.map((s) => ({
      id: s.id, companyId: s.companyId, company: s.company, season: s.season,
      position: s.position, priority: s.priority, status: s.status, outcome: outcomeOf(s.status),
      steps: s.steps, nextAction: s.nextAction, nextDate: s.nextDate,
      submitted: s.submitted, esUrl: s.esUrl, memo: s.memo,
    })),
    appointments: listAppointments(db),
    events: listEvents(db),
    enrichedEvents: platform.enrichedEvents,
    // 活動ログはイベント台帳が正。「なぜ今この状態か」を後から追うための行
    activities: listEvents(db).map((e) => ({
      at: e.at, what: `${companyOf.get(e.selection_id) ?? ''} ${e.kind}`.trim(),
      why: e.summary, how: e.source || 'agent',
    })).reverse(),
    profile: platform.profile,
    profileSuggestions: platform.profileSuggestions,
    people: platform.people,
    personNotes: platform.personNotes,
    interviews: platform.interviews,
    submissions: platform.submissions,
    dossiers: platform.dossiers,
    mailItems: platform.mailItems,
    pending: listPending(db).map((p) => ({ name: p.name, context: p.context, createdAt: p.created_at })),
  }
}

/** 架空データだけでアプリ群を一通り埋める。実在の企業・人物は登場しない */
function seedDemo(db: DatabaseSync): void {
  const rows = [
    { company: '株式会社アルファ', industry: 'SaaS', season: '本選考', position: 'ソフトウェアエンジニア', priority: 'A', status: '最終面接済・結果待ち', next: '結果を待つ', date: '2026-08-21', steps: ['ES', '適性検査', '一次面接', '最終面接'], submitted: true, memo: '' },
    { company: 'ベータ工業株式会社', industry: '製造', season: '夏', position: '技術総合職', priority: 'B', status: '一次面接済', next: '二次面接の日程調整', date: '2026-08-19', steps: ['ES', '一次面接'], submitted: false, memo: '' },
    { company: '合同会社ガンマ', industry: 'コンサル', season: '本選考', position: 'ビジネスコンサルタント', priority: 'B', status: '出願済', next: '適性検査を受ける', date: '2026-08-18', steps: ['ES'], submitted: false, memo: '（受検はテストセンター）' },
    { company: 'Delta Systems Inc.', industry: 'SIer', season: '冬', position: 'データエンジニア', priority: 'C', status: '出願予定', next: 'ESを書く', date: '2026-08-25', steps: [], submitted: false, memo: '' },
    { company: '株式会社イプシロン', industry: 'Web', season: '夏', position: 'プロダクトデザイナー', priority: 'A', status: '内定', next: '承諾期限までに返答', date: '2026-08-28', steps: ['ES', '一次面接', '最終面接'], submitted: true, memo: '' },
    { company: 'ゼータ商事株式会社', industry: '商社', season: '本選考', position: '総合職', priority: 'C', status: '不合格', next: '', date: '', steps: ['ES', '一次面接'], submitted: true, memo: '' },
    { company: '株式会社イータ', industry: 'ヘルスケア', season: '夏', position: 'エンジニア', priority: 'B', status: '辞退', next: '', date: '', steps: ['ES'], submitted: true, memo: '' },
  ]

  const companyIds = new Map<string, number>()
  for (const r of rows) {
    const id = upsertCompany(db, {
      name: r.company, industry: r.industry,
      mypageUrl: `https://example.com/mypage/${encodeURIComponent(r.company)}`,
      memo: r.memo,
    })
    companyIds.set(r.company, id)
    insertSelection(db, id, {
      company: r.company, season: r.season, position: r.position, priority: r.priority,
      status: r.status, steps: r.steps, nextAction: r.next, nextDate: r.date,
      submitted: r.submitted, esUrl: '', memo: r.memo,
    })
  }

  const byCompany = new Map(listSelections(db).map((s) => [s.company, s.id]))
  const appts: [string, string, string, string, string, string, string][] = [
    ['株式会社アルファ', '2026-08-21T10:00:00+09:00', '2026-08-21T11:00:00+09:00', '面接', '結果連絡の面談', '', '（人事）'],
    ['ベータ工業株式会社', '2026-08-19T15:00:00+09:00', '2026-08-19T16:00:00+09:00', '面接', '二次面接', '（本社・対面）', '（技術部門）'],
    ['合同会社ガンマ', '2026-08-18T23:59:00+09:00', '', '締切', '適性検査の受検期限', '', ''],
    ['株式会社イプシロン', '2026-08-28T12:00:00+09:00', '', '締切', '内定承諾の回答期限', '', ''],
    ['Delta Systems Inc.', '2026-08-25T23:59:00+09:00', '', '締切', 'ES提出期限', '', ''],
  ]
  for (const [company, at, endAt, kind, title, location, person] of appts) {
    const selectionId = byCompany.get(company)
    if (selectionId === undefined) continue
    addAppointment(db, {
      selectionId, at, endAt, kind, title, location, person,
      url: kind === '面接' && !location ? 'https://example.com/meeting' : '',
    })
  }

  const events: [string, string, string, string, string][] = [
    ['株式会社アルファ', '2026-08-14T09:12:00+09:00', '選考通過', 'メールに「最終面接へお進みいただきます」とあった', 'mail'],
    ['ベータ工業株式会社', '2026-08-15T18:40:00+09:00', '日程打診', '候補日3つの案内メールを受信。返信はまだ', 'mail'],
    ['株式会社イプシロン', '2026-08-16T08:05:00+09:00', '内定', '内定通知と承諾期限(8/28)の案内', 'mail'],
    ['ゼータ商事株式会社', '2026-08-12T11:30:00+09:00', '不合格', 'お見送りの連絡。トラックを終了に確定した', 'mail'],
  ]
  for (const [company, at, kind, summary, source] of events) {
    const selectionId = byCompany.get(company)
    if (selectionId === undefined) continue
    addEvent(db, selectionId, kind, summary, source, at)
  }

  // 人(people アプリの移植で使う)。架空の役職ラベルだけ
  const people: [string, string, string, string, string][] = [
    ['（人事担当A）', '株式会社アルファ', '採用担当', '面接官', '2026-08-14'],
    ['（技術面接官B）', 'ベータ工業株式会社', 'エンジニアリングマネージャ', '面接官', '2026-08-19'],
    ['（リクルーターC）', '株式会社イプシロン', 'リクルーター', 'リクルーター', '2026-07-30'],
  ]
  for (const [name, company, role, category, metAt] of people) {
    upsertPerson(db, { name, company, role, category, metAt, howMet: '（説明会で）', followUp: '' })
  }

  upsertCompanyDossier(db, companyIds.get('株式会社アルファ')!, {
    summary: '（企業研究の要約。架空)', facts: { founded: 2015, employees: 320 },
    sources: [{ title: '（一次情報のタイトル）', url: 'https://example.com/ir' }],
    researchedAt: '2026-08-10T00:00:00+09:00', sourceRef: 'demo',
  })

  const mails: [string, string, string, string, string, string][] = [
    ['demo-1', '株式会社アルファ', '最終面接の結果について', '結果連絡の面談日程が案内されている', '選考案内', '2026-08-20'],
    ['demo-2', 'ベータ工業株式会社', '二次面接の日程調整のお願い', '候補日3つから選んで返信が必要', '日程調整', '2026-08-18'],
    ['demo-3', '株式会社イプシロン', '内定のご連絡と承諾期限', '承諾書の提出期限が案内されている', '内定', '2026-08-28'],
    ['demo-4', '', '合同説明会のご案内', '任意参加のイベント案内', 'その他', ''],
  ]
  for (const [id, company, subject, summary, category, deadline] of mails) {
    upsertMailItem(db, {
      id, companyId: company ? companyIds.get(company) : null, receivedAt: '2026-08-16T08:00:00+09:00',
      sender: 'noreply@example.com', subject, summary, category, needsAction: true, deadline,
    })
  }

  // 名寄せが怪しかった入力(法人格違い)。アプリの「確認待ち」に出る
  addPending(db, '株式会社ガンマ', '既存「合同会社ガンマ」と紛らわしい。同一なら別名として学習、別会社ならこのままでよい')
}

function main(): void {
  const demo = process.argv.includes('--demo')
  const dbPath = demo
    ? ':memory:'
    : (process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.KATAZUKU_DB ?? 'data/katazuku.db')
  const db = openDb(dbPath)
  if (demo) seedDemo(db)

  const snapshot = buildSnapshot(db, demo)
  const name = demo ? 'snapshot.demo.json' : 'snapshot.json'
  for (const app of TARGETS) {
    const out = join(here, '..', app, 'public', name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    console.log(`${out} に書き出しました`)
  }
  db.close()

  const n = (k: string) => (snapshot[k] as unknown[]).length
  console.log(`  選考 ${n('selections')} / 予定 ${n('appointments')} / ログ ${n('activities')} / 人 ${n('people')} / メール ${n('mailItems')} / 確認待ち ${n('pending')}`)
  if (!demo) console.log('  ※ 実データを含みます。snapshot.json はコミットしないでください(.gitignore 済み)')
}

main()
