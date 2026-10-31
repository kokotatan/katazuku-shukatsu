import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { validateJsonSchema } from './agent-runtime.js'
import { openDb } from './db.js'
import { applyCalendar } from './db-apply-calendar.js'
import { applyMail } from './db-apply-mail.js'
import { applySubmission } from './db-apply-submission.js'
import { applyInterview, type InterviewInput } from './db-apply-interview.js'
import { listActionableMail, listPlatformSnapshot } from './platform.js'
import { applyCompanyResearch } from './company-research.js'
import { meetingPreparationContext, meetingPreparationSnapshot, saveMeetingPreparation } from './meeting-preparation.js'
import { excludeCompany } from './company-preference.js'
import { applyPeopleResearch } from './people-research.js'
import { openDbReadOnly, quickRead, type QuickCommand } from './quick-read.js'
import { getDatabaseContext, getScheduleAvailability } from './schedule.js'
import { listSubmissionRequirements } from './submission-requirement.js'
import {
  getWorkflowRun,
  loadWorkflowContract,
  openWorkflowStore,
  requestWorkflowApproval,
  startWorkflowRun,
  workflowHash,
} from './workflow-control.js'

export const KATAZUKU_MCP_SCOPES = ['read', 'write', 'sensitive', 'actions'] as const
export type KatazukuMcpScope = typeof KATAZUKU_MCP_SCOPES[number]

type Tool = {
  name: string
  scope: KatazukuMcpScope
  description: string
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
  inputSchema: Record<string, unknown>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, properties, required,
})
const text = { type: 'string', minLength: 1 }
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

const allTools: Tool[] = [
  { name: 'katazuku_today', scope: 'read', description: '今日の面接・面談・説明会・締切を正本DBから返す。', annotations: readAnnotations, inputSchema: objectSchema({}) },
  { name: 'katazuku_next', scope: 'read', description: '今後の予定を近い順に返す。', annotations: readAnnotations, inputSchema: objectSchema({ count: { type: 'integer', minimum: 1, maximum: 30 } }, []) },
  { name: 'katazuku_conflicts', scope: 'read', description: '時間の重なる予定を返す。', annotations: readAnnotations, inputSchema: objectSchema({ days: { type: 'integer', minimum: 1, maximum: 60 } }, []) },
  { name: 'katazuku_status', scope: 'read', description: '応募企業ごとの選考状況を返す。', annotations: readAnnotations, inputSchema: objectSchema({ company: { ...text, maxLength: 100 } }, []) },
  { name: 'katazuku_availability', scope: 'read', description: '正本・Calendar同期鮮度・移動を含め、候補日時をavailable/conflict/unknownで判定する。unknownを空きと扱わない。', annotations: readAnnotations,
    inputSchema: objectSchema({ startAt: text, endAt: text, excludeAppointmentId: { type: 'integer', minimum: 1 } }, ['startAt', 'endAt']) },
  { name: 'katazuku_submissions', scope: 'read', description: '提出物台帳を返す。openOnlyは未完了だけに絞る。', annotations: readAnnotations,
    inputSchema: objectSchema({ openOnly: { type: 'boolean' } }, []) },
  { name: 'katazuku_meeting_preparations', scope: 'read', description: '今後の面接・面談ごとの準備ready/pending、理由、公開可能な準備内容を返す。', annotations: readAnnotations, inputSchema: objectSchema({}) },
  { name: 'katazuku_actionable_mail', scope: 'read', description: '正本DBにある要対応メールの要約を返す。メール本文は保存・返却しない。', annotations: readAnnotations, inputSchema: objectSchema({}) },
  { name: 'katazuku_snapshot', scope: 'sensitive', description: 'プロフィール、人脈、面談、企業研究、提出、メール要約を含む個人スナップショットを返す。画像本体は含めない。', annotations: readAnnotations, inputSchema: objectSchema({}) },
  { name: 'katazuku_meeting_preparation_context', scope: 'sensitive', description: '面接準備の作成に必要な根拠hash、相手メモ、過去面談要約、企業研究を返す。文字起こしpathと内部JSONは返さない。', annotations: readAnnotations, inputSchema: objectSchema({}) },
  { name: 'katazuku_record_mail', scope: 'write', description: '取得済みメールの構造化要約を正本DBへ冪等反映する。第三者送信は行わない。', annotations: writeAnnotations,
    inputSchema: objectSchema({ items: { type: 'array', minItems: 1, maxItems: 200, items: objectSchema({
      id: text, receivedAt: text, sender: { type: 'string' }, subject: text, summary: { type: 'string' }, category: { type: 'string' }, needsAction: { type: 'boolean' }, deadline: { type: 'string' }, status: { type: 'string' }, company: { type: 'string' }, position: { type: 'string' }, sourceRef: { type: 'string' },
    }, ['id', 'receivedAt', 'subject']) } }) },
  { name: 'katazuku_record_submission', scope: 'write', description: '提出・結果の根拠をsourceRefで冪等反映する。受験や提出そのものは行わない。', annotations: writeAnnotations,
    inputSchema: objectSchema({ sourceRef: text, company: text, position: { type: 'string' }, kind: text, submittedAt: text, result: { type: 'string' }, detail: { type: 'string' } }, ['sourceRef', 'company', 'kind', 'submittedAt']) },
  { name: 'katazuku_record_calendar', scope: 'write', description: '取得済みCalendarイベントをexternalIdで正本DBへ冪等反映する。外部カレンダーの作成・変更は行わない。', annotations: writeAnnotations,
    inputSchema: objectSchema({ events: { type: 'array', minItems: 1, maxItems: 500, items: objectSchema({
      externalId: text, calendarId: { type: 'string' }, title: text, startAt: text, endAt: { type: 'string' }, company: text, position: { type: 'string' }, kind: { type: 'string' }, url: { type: 'string' }, location: { type: 'string' }, status: { type: 'string' }, sourceHash: { type: 'string' },
    }, ['externalId', 'title', 'startAt', 'company']) } }) },
  { name: 'katazuku_record_people_research', scope: 'write', description: '公開情報等から得た人物調査を出典・日時・confidence付きで人物台帳へ冪等反映する。学生・同級生の大学名は企業マスタにしない。', annotations: writeAnnotations,
    inputSchema: objectSchema({
      sourceRef: { ...text, maxLength: 500 }, researchedAt: text,
      people: { type: 'array', minItems: 1, maxItems: 200, items: objectSchema({
        name: { ...text, maxLength: 200 }, company: { type: 'string', maxLength: 200 }, role: { type: 'string', maxLength: 300 },
        category: { type: 'string', maxLength: 100 }, notes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4000 } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      }, ['name', 'notes']) },
    }) },
  { name: 'katazuku_record_company_research', scope: 'write', description: '既存企業への調査結果を一次情報URL・調査日時・sourceRef付きで正本へ反映する。企業の新規作成や古い調査による巻き戻しは行わない。', annotations: writeAnnotations,
    inputSchema: objectSchema({
      company: { ...text, maxLength: 200 }, summary: { ...text, maxLength: 16000 },
      facts: { type: 'object', maxProperties: 200 }, researchedAt: text, sourceRef: { ...text, maxLength: 500 },
      sources: { type: 'array', minItems: 1, maxItems: 100, items: objectSchema({
        title: { ...text, maxLength: 500 }, url: { ...text, maxLength: 3000 },
      }) },
    }, ['company', 'summary', 'sources', 'researchedAt', 'sourceRef']) },
  { name: 'katazuku_record_interview', scope: 'write', description: '面接・面談の構造化議事録をrunIdで冪等反映し、人物メモ・プロフィール候補・予定完了状態を同一トランザクションで更新する。ローカルpathや顔写真は受け付けない。', annotations: writeAnnotations,
    inputSchema: objectSchema({
      runId: { ...text, maxLength: 300 }, appointmentId: { type: 'integer', minimum: 1 }, careerMeetingId: { type: 'integer', minimum: 1 },
      contextKind: { type: 'string', enum: ['selection', 'career_support'] }, company: { type: 'string', maxLength: 200 },
      organization: { type: 'string', maxLength: 200 }, position: { type: 'string', maxLength: 500 }, occurredAt: text,
      title: { ...text, maxLength: 500 }, summary: { ...text, maxLength: 16000 },
      questions: { type: 'array', maxItems: 100, items: objectSchema({
        question: { ...text, maxLength: 4000 }, answer: { type: 'string', maxLength: 12000 }, feedback: { type: 'string', maxLength: 8000 },
      }, ['question']) },
      people: { type: 'array', maxItems: 100, items: objectSchema({
        name: { ...text, maxLength: 200 }, company: { type: 'string', maxLength: 200 }, role: { type: 'string', maxLength: 300 },
        category: { type: 'string', maxLength: 100 }, notes: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4000 } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      }, ['name']) },
      profileSuggestions: { type: 'array', maxItems: 100, items: objectSchema({
        field: { ...text, maxLength: 200 }, value: {}, confidence: { type: 'number', minimum: 0, maximum: 1 },
      }, ['field', 'value']) },
      followUps: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4000 } },
    }, ['runId', 'occurredAt', 'title', 'summary']) },
  { name: 'katazuku_exclude_company', scope: 'write', description: '本人が既に対象外と決めた企業を正本へ記録し、既存トラックとローカル予定を停止する。外部カレンダーや第三者には変更・通知しない。', annotations: writeAnnotations,
    inputSchema: objectSchema({ name: { ...text, maxLength: 200 }, reason: { ...text, maxLength: 1000 }, ref: { ...text, maxLength: 500 } }) },
  { name: 'katazuku_record_meeting_preparation', scope: 'write', description: '根拠hashと一次情報を検証し、面接・面談ごとの準備成果物を正本DBへ冪等保存する。企業研究なし・古い根拠・必須項目不足は拒否する。', annotations: writeAnnotations,
    inputSchema: objectSchema({
      appointmentId: { type: 'integer', minimum: 1 }, contextHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, preparedAt: text,
      sourceRef: text, summary: text, counterpartResearch: text, priorContext: text,
      questionsToAsk: { type: 'array', minItems: 3, items: text },
      anticipatedQuestions: { type: 'array', minItems: 3, items: objectSchema({ question: text, answerOutline: text, evidenceRef: text }) },
      sources: { type: 'array', minItems: 1, items: objectSchema({ title: text, url: text }) },
      unknowns: { type: 'array', items: { type: 'string' } },
    }) },
  { name: 'katazuku_prepare_action', scope: 'actions', description: '第三者への送信・予約等を実行せず、対象・内容・実行時点・通知内容を承認台帳へ固定する。専用Executorと本人承認が別途必要。', annotations: writeAnnotations,
    inputSchema: objectSchema({ runId: { ...text, maxLength: 160 }, sourceRef: { ...text, maxLength: 300 }, action: objectSchema({ actionType: text, target: { type: 'object', minProperties: 1 }, content: { type: 'object', minProperties: 1 }, effectiveAt: text, notification: text }) }) },
  { name: 'katazuku_action_status', scope: 'actions', description: '承認台帳の状態と固定済みaction hashを返す。実行や承認は行わない。', annotations: readAnnotations,
    inputSchema: objectSchema({ runId: { ...text, maxLength: 160 } }) },
]

export const KATAZUKU_MCP_INSTRUCTIONS = [
  'katazuku-shukatsuは日本の新卒就職活動を管理するローカルファースト基盤です。終活ではありません。',
  '予定・選考・提出物はGmailやCalendarを再検索する前にkatazuku_*の正本DBから確認します。',
  'write scopeは取得済み事実の冪等な正本反映だけです。メール送信・応募提出・予約・受験・認証は行いません。',
  '面接・面談を扱うときはkatazuku_meeting_preparationsを確認し、sensitive scopeがあれば根拠contextを取得して準備をreadyにします。',
  '第三者確定操作はkatazuku_prepare_actionで固定し、本人承認と専用Executorへ引き継ぎます。MCPのtool call自体を本人承認とみなしません。',
].join('\n')

export interface KatazukuMcpOptions {
  dbPath: string
  workflowStorePath: string
  scopes?: Iterable<KatazukuMcpScope>
  now?: () => Date
  contractPath?: string
}

export class KatazukuMcpServer {
  readonly scopes: Set<KatazukuMcpScope>
  private readonly contractPath: string
  constructor(private readonly options: KatazukuMcpOptions) {
    this.scopes = new Set(options.scopes ?? ['read'])
    for (const scope of this.scopes) if (!KATAZUKU_MCP_SCOPES.includes(scope)) throw new Error(`未知のMCP scopeです: ${scope}`)
    this.contractPath = options.contractPath ?? fileURLToPath(new URL('../workflows/mcp-third-party-action.json', import.meta.url))
  }

  tools(): Tool[] { return allTools.filter((tool) => this.scopes.has(tool.scope)) }

  private read<T>(work: (db: DatabaseSync) => T): T {
    if (!existsSync(this.options.dbPath)) throw new Error('正本DBが見つかりません。KATAZUKU_DBを指定し、先にnpm run initを実行してください')
    const db = openDbReadOnly(this.options.dbPath)
    try { return work(db) } finally { db.close() }
  }

  private write<T>(work: (db: DatabaseSync) => T): T {
    if (!existsSync(this.options.dbPath)) throw new Error('正本DBが見つかりません。先にnpm run initを実行してください')
    const db = openDb(this.options.dbPath)
    try {
      const context = getDatabaseContext(db)
      if (context.role !== 'canonical') throw new Error(`正本DB以外へは書き込めません(role=${context.role})`)
      return work(db)
    } finally { db.close() }
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools().find((candidate) => candidate.name === name)
    if (!tool) throw new Error('未知または許可されていないツールです')
    const errors = validateJsonSchema(args, tool.inputSchema)
    if (errors.length) throw new Error(`ツール引数が不正です: ${errors.slice(0, 8).join('; ')}`)

    const reads: Record<string, QuickCommand> = {
      katazuku_today: 'today', katazuku_next: 'next', katazuku_conflicts: 'conflicts', katazuku_status: 'status',
    }
    if (reads[name]) {
      const arg = name === 'katazuku_next' ? args.count : name === 'katazuku_conflicts' ? args.days : name === 'katazuku_status' ? args.company : undefined
      return this.read((db) => quickRead(db, reads[name], arg as string | number | undefined, this.options.now?.().getTime()))
    }
    if (name === 'katazuku_availability') return this.read((db) => getScheduleAvailability(db, String(args.startAt), String(args.endAt), {
      excludeAppointmentId: args.excludeAppointmentId as number | undefined, now: this.options.now?.(), databaseRole: 'canonical',
    }))
    if (name === 'katazuku_submissions') return this.read((db) => listSubmissionRequirements(db, { openOnly: Boolean(args.openOnly) }))
    if (name === 'katazuku_meeting_preparations') return this.read((db) => meetingPreparationSnapshot(db, this.options.now?.()).map((preparation) => ({
      appointmentId: preparation.appointmentId, companyId: preparation.companyId, company: preparation.company,
      at: preparation.at, title: preparation.title, status: preparation.status, reasons: preparation.reasons, urgent: preparation.urgent,
    })))
    if (name === 'katazuku_actionable_mail') return this.read((db) => listActionableMail(db))
    if (name === 'katazuku_snapshot') return this.read((db) => listPlatformSnapshot(db))
    if (name === 'katazuku_meeting_preparation_context') return this.read((db) => meetingPreparationContext(db, this.options.now?.()))
    if (name === 'katazuku_record_mail') return this.write((db) => applyMail(db, args as unknown as Parameters<typeof applyMail>[1]))
    if (name === 'katazuku_record_submission') return this.write((db) => applySubmission(db, args as unknown as Parameters<typeof applySubmission>[1]))
    if (name === 'katazuku_record_calendar') return this.write((db) => applyCalendar(args as unknown as Parameters<typeof applyCalendar>[0], db))
    if (name === 'katazuku_record_people_research') return this.write((db) => applyPeopleResearch(db, args as unknown as Parameters<typeof applyPeopleResearch>[1]))
    if (name === 'katazuku_record_company_research') return this.write((db) => applyCompanyResearch(db, args as unknown as Parameters<typeof applyCompanyResearch>[1]))
    if (name === 'katazuku_record_interview') {
      // MCP入力には transcriptPath/photoPath がschema上存在しない。ローカルファイルへの
      // 任意アクセスを遠隔クライアントへ広げず、構造化した議事録だけを既存writerへ渡す。
      return this.write((db) => applyInterview(args as unknown as InterviewInput, db))
    }
    if (name === 'katazuku_exclude_company') return this.write((db) => excludeCompany(db, args as unknown as Parameters<typeof excludeCompany>[1], this.options.now?.()))
    if (name === 'katazuku_record_meeting_preparation') return this.write((db) => saveMeetingPreparation(db, args, this.options.now?.()))
    if (name === 'katazuku_prepare_action') {
      const contract = loadWorkflowContract(this.contractPath)
      const store = openWorkflowStore(this.options.workflowStorePath)
      try {
        const target = this.read((db) => getDatabaseContext(db, 'canonical'))
        startWorkflowRun(store, contract, { sourceRef: args.sourceRef }, target, String(args.runId), this.options.now?.())
        const state = getWorkflowRun(store, String(args.runId))
        if (state.approval) {
          if (state.approval.actionHash !== workflowHash(args.action)) throw new Error('同じrunIdへ異なる操作を提示できません')
          return state
        }
        requestWorkflowApproval(store, contract, String(args.runId), 'approve', args.action, target, this.options.now?.())
        return getWorkflowRun(store, String(args.runId))
      } finally { store.close() }
    }
    if (name === 'katazuku_action_status') {
      const store = openWorkflowStore(this.options.workflowStorePath)
      try { return getWorkflowRun(store, String(args.runId)) } finally { store.close() }
    }
    throw new Error('ツール実装がありません')
  }
}

export function defaultWorkflowStorePath(dbPath: string): string { return join(dirname(dbPath), 'workflow-control.db') }

export async function katazukuRpc(server: KatazukuMcpServer, input: unknown): Promise<unknown | undefined> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  const message = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
  const fail = (code: number, messageText: string) => ({ jsonrpc: '2.0', id, error: { code, message: messageText } })
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(-32600, 'Invalid Request')
  if (message.id === undefined) return undefined
  if (id === null) return fail(-32600, 'Invalid Request')
  if (message.method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'katazuku-shukatsu', title: 'katazuku就活管理', version: '0.3.0' }, instructions: KATAZUKU_MCP_INSTRUCTIONS })
  if (message.method === 'ping') return ok({})
  if (message.method === 'tools/list') return ok({ tools: server.tools().map(({ scope: _scope, ...tool }) => tool) })
  if (message.method !== 'tools/call') return fail(-32601, 'Method not found')
  const params = message.params as { name?: unknown; arguments?: unknown } | undefined
  if (typeof params?.name !== 'string' || !params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments)) return fail(-32602, 'Invalid params')
  try {
    const result = await server.call(params.name, params.arguments as Record<string, unknown>)
    return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result }, isError: false })
  } catch (error) {
    return ok({ content: [{ type: 'text', text: error instanceof Error ? error.message : '処理できませんでした' }], isError: true })
  }
}
