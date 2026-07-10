import type { Company } from '../types'

/** 公開デモ用の初期データ。型・件数・ステージ分布の見本となる汎用サンプル(実在の選考ではない) */
export function makeInitialCompanies(): Company[] {
  const now = new Date().toISOString()
  const c = (data: Omit<Company, 'updatedAt'>): Company => ({ ...data, updatedAt: now })
  return [
    c({
      id: 'sample-a',
      name: '株式会社サンプルテック',
      role: 'エンジニア職',
      stage: 'interview',
      nextAction: '一次面接の日程を回答する',
      nextDate: '2026-06-16',
      memo: 'サンプル: カジュアル面談を経て一次面接へ。候補日を複数提示すると調整が速い。',
    }),
    c({
      id: 'sample-b',
      name: '株式会社サンプルワークス',
      role: 'サマーインターン「新規事業立案」',
      stage: 'interview',
      nextAction: 'カジュアル面談の候補日をフォームから回答',
      nextDate: '2026-06-12',
      memo: 'サンプル: イベント前のオンライン面談(30分)。',
    }),
    c({
      id: 'sample-c',
      name: '株式会社サンプルソフト',
      role: 'ハッカソン選考',
      stage: 'task',
      nextAction: '技術課題を提出する',
      nextDate: '2026-06-29',
      memo: 'サンプル: 提出期限は正午。招待リンクから提出する。',
    }),
    c({
      id: 'sample-d',
      name: '株式会社サンプルキャリア',
      role: 'サマーインターン特別枠',
      stage: 'entried',
      nextAction: '特別枠の予約フォームに回答',
      nextDate: '2026-06-12',
      memo: 'サンプル: 他社通過で一部選考がスキップされる場合あり。',
    }),
    c({
      id: 'sample-e',
      name: '株式会社サンプル広告',
      role: 'ビジネスデザインコース',
      stage: 'task',
      nextAction: 'ES提出と適性検査を完了させる',
      nextDate: '2026-06-25',
      memo: 'サンプル: 締切直前は混み合うため余裕を持って提出する。',
    }),
    c({
      id: 'sample-f',
      name: 'サンプル金融株式会社',
      role: '夏インターン(本選考接続型)',
      stage: 'task',
      nextAction: 'ESをマイページから提出',
      nextDate: '2026-06-15',
      memo: 'サンプル: 金融×地域活性のプログラム。',
    }),
    c({
      id: 'sample-g',
      name: 'サンプル製造株式会社',
      role: 'Summer Internship 2026',
      stage: 'scouted',
      nextAction: '本エントリーするか決める',
      nextDate: '2026-06-15',
      memo: 'サンプル: 締切は当日23:59。',
    }),
    c({
      id: 'sample-h',
      name: 'サンプル銀行',
      role: 'SUMMER INTERNSHIP',
      stage: 'scouted',
      nextAction: 'プログラムを選んで申し込むか決める',
      nextDate: '2026-06-22',
      memo: 'サンプル: 複数コースから選んで申し込む。',
    }),
    c({
      id: 'sample-i',
      name: 'サンプル電機株式会社',
      role: '職場密着インターンシップ',
      stage: 'scouted',
      nextAction: 'コースを選んで応募',
      nextDate: '2026-06-23',
      memo: 'サンプル: 受付期間内に応募する。',
    }),
  ]
}
