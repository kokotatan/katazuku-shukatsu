import type { Company } from '../types'

/** 実際のメールから判明している選考状況を初期データにする(2026-06-11時点) */
export function makeInitialCompanies(): Company[] {
  const now = new Date().toISOString()
  const c = (data: Omit<Company, 'updatedAt'>): Company => ({ ...data, updatedAt: now })
  return [
    c({
      id: 'pksha',
      name: '株式会社PKSHA Technology',
      role: 'エンジニア職',
      stage: 'interview',
      nextAction: '面接の再調整連絡を待つ(返信済み)',
      nextDate: '2026-06-16',
      memo: '6/11の面接に遅刻。候補日として6/11午後・6/12午前・6/16終日を提示済み。',
    }),
    c({
      id: 'timee',
      name: '株式会社タイミー',
      role: '3days summer job「次世代経営会議」',
      stage: 'interview',
      nextAction: 'カジュアル面談の日程候補をURLから回答',
      nextDate: '2026-06-12',
      memo: 'イベント前面談(オンライン30分)。複数候補日を出すと調整が速い。',
    }),
    c({
      id: 'layerx',
      name: '株式会社LayerX',
      role: 'ハッカソン選考',
      stage: 'task',
      nextAction: '技術課題を提出(GitHub)',
      nextDate: '2026-06-29',
      memo: '提出期限 6/29(月) 12:00。Outside Collaborator招待済み。結果は7/7まで。課題内容は口外禁止。',
    }),
    c({
      id: 'nextbeat',
      name: '株式会社ネクストビート',
      role: 'サマーインターン特別枠',
      stage: 'entried',
      nextAction: '特別枠(ES・録画面接免除)の予約フォームに回答',
      nextDate: '2026-06-12',
      memo: '最終締切6/12(金)。日程が合わなければAI面接に切替可。他社サマー通過で選考スキップあり。',
    }),
    c({
      id: 'hakuhodo',
      name: '株式会社博報堂',
      role: 'ビジネスデザイン篇',
      stage: 'task',
      nextAction: 'ES提出+受検を完了させる',
      nextDate: '2026-06-25',
      memo: '締切 6/25(木) 12:00。直前は回線が混むので余裕を持って。',
    }),
    c({
      id: 'nochubank',
      name: '農林中央金庫',
      role: '夏インターン(本選考接続型)',
      stage: 'task',
      nextAction: 'ESをマイページから提出',
      nextDate: '2026-06-15',
      memo: '金融×地方創生。',
    }),
    c({
      id: 'jt',
      name: '日本たばこ産業(JT)',
      role: 'Summer Internship 2026',
      stage: 'scouted',
      nextAction: '本エントリーするか決める',
      nextDate: '2026-06-15',
      memo: '〆切 6/15(月) 23:59。',
    }),
    c({
      id: 'smbc',
      name: '三井住友銀行(SMBC)',
      role: 'SUMMER INTERNSHIP',
      stage: 'scouted',
      nextAction: 'プログラムを選んで申し込むか決める',
      nextDate: '2026-06-22',
      memo: '〆切 6/22(月) 12:00。現場最前線系の3プログラム紹介あり。',
    }),
    c({
      id: 'sony',
      name: 'ソニー株式会社',
      role: '職場密着インターンシップ',
      stage: 'scouted',
      nextAction: '58コースから選んで応募',
      nextDate: '2026-06-23',
      memo: '受付 6/11 10:00〜6/23 10:00。',
    }),
  ]
}
