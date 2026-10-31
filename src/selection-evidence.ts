import type { DiffItem } from './db-apply.js'
import type { MailInput } from './daily-sync-input.js'

export type EvidenceSelection = DiffItem & { evidence?: SelectionEvidence }

export type SelectionEvidenceKind =
  | 'direct_scout_accepted'
  | 'application_submitted'
  | 'selection_action_required'
  | 'interview_scheduled'
  | 'participation_confirmed'
  | 'offer_received'
  | 'rejected'
  | 'withdrawn'

export interface SelectionEvidence {
  messageId: string
  kind: SelectionEvidenceKind
  quote: string
}

export interface RejectedSelectionEvidence {
  name: string
  stage: string
  ref: string
  reason: 'missing_evidence' | 'message_mismatch' | 'stage_mismatch' | 'quote_not_found' | 'semantic_mismatch'
}

const EVIDENCE_KIND_BY_STAGE: Record<string, SelectionEvidenceKind> = {
  scouted: 'direct_scout_accepted',
  entried: 'application_submitted',
  task: 'selection_action_required',
  interview: 'interview_scheduled',
  intern: 'participation_confirmed',
  offer: 'offer_received',
  rejected: 'rejected',
  closed: 'withdrawn',
}

function normalizeEvidenceText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function evidenceSemanticsMatch(kind: SelectionEvidenceKind, quote: string): boolean {
  const positive: Record<SelectionEvidenceKind, RegExp> = {
    direct_scout_accepted: /(スカウト.{0,20}(承諾|応募)|(承諾|応募).{0,20}スカウト)/,
    application_submitted: /(応募|エントリー).{0,24}(完了|受け付け|受付|ありがとう)|(完了|受け付け|受付).{0,24}(応募|エントリー)/,
    selection_action_required: /(ご?提出|未提出|受検|受験|適性検査|参加必須|ご?予約|マイページ).{0,40}(ください|必要|期限|締切|案内|確認)|((期限|締切).{0,40}(ご?提出|受検|受験|適性検査|ご?予約))/,
    interview_scheduled: /(面接|面談).{0,40}(日程|日時|開催日|予約|ご相談|明日)|(日程|日時|開催日|予約).{0,40}(面接|面談)/,
    participation_confirmed: /(合格|採択|参加確定|参加者に決定|選考結果)/,
    offer_received: /(内定|労働条件通知書|採用内定)/,
    rejected: /(不合格|お見送り|選考を見送)/,
    withdrawn: /(辞退.{0,24}(受け付け|受付|完了|承知)|(受け付け|受付).{0,24}辞退)/,
  }
  const negative: Partial<Record<SelectionEvidenceKind, RegExp>> = {
    direct_scout_accepted: /(スカウト.{0,16}(届|招待|限定)|承諾しませんか)/,
    application_submitted: /(受付中|お済みですか|応募してください|ご応募ください|エントリー受付中|希望について)/,
    selection_action_required: /(エントリーはお済みですか|応募受付中|ご応募ください)/,
    interview_scheduled: /(面接対策|セミナー|説明会)/,
    participation_confirmed: /(募集|受付中|応募|参加しませんか|ご参加ください)/,
  }
  return positive[kind].test(quote) && !(negative[kind]?.test(quote) ?? false)
}

/**
 * selectionへ昇格する根拠を、取得済み元メールと突合する。
 * 不正・弱い根拠はメール記録には残してもselectionへは渡さず、件数ブレーキの前で除外する。
 */
export function filterSelectionsByEvidence(
  selections: EvidenceSelection[],
  input: MailInput,
): { accepted: EvidenceSelection[]; rejected: RejectedSelectionEvidence[] } {
  const messages = new Map(input.messages.map((message) => [message.id, message]))
  const accepted: EvidenceSelection[] = []
  const rejected: RejectedSelectionEvidence[] = []
  for (const selection of selections) {
    const evidence = selection.evidence
    const ref = String(selection.ref ?? '')
    let reason: RejectedSelectionEvidence['reason'] | undefined
    if (!evidence) reason = 'missing_evidence'
    else if (evidence.messageId !== ref || !messages.has(ref)) reason = 'message_mismatch'
    else if (EVIDENCE_KIND_BY_STAGE[selection.stage] !== evidence.kind) reason = 'stage_mismatch'
    else {
      const message = messages.get(ref)!
      const quote = normalizeEvidenceText(evidence.quote)
      const haystack = normalizeEvidenceText([message.subject, message.snippet, message.body].join('\n'))
      if (!quote || !haystack.includes(quote)) reason = 'quote_not_found'
      else if (!evidenceSemanticsMatch(evidence.kind, quote)) reason = 'semantic_mismatch'
    }
    if (reason) rejected.push({ name: selection.name, stage: selection.stage, ref, reason })
    else accepted.push(selection)
  }
  return { accepted, rejected }
}

