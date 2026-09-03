/**
 * 公開API面(エントリポイント)。
 *
 * ここに出ている名前が公開契約です。SemVer はこの面に対してかかります。
 * `src/*` を直接 import すると内部実装に依存することになるので、利用側は必ずこの入口を使ってください。
 *
 * 内部専用として意図的に出していないもの:
 * - `normalize` / `normalizeSurface` / `designatorsOf` / `rank`(名寄せ・順位付けの実装詳細)
 * - `commandPreview` / `detectProcessFailure` / `resolveProviderCommands` /
 *   `detectCodexExtraCapabilities` / `parseWebSearchArgs`(agent-runtime の内部・デバッグ補助)
 */

// ---- 正本DBとセマンティックレイヤー ----
export {
  openDb,
  SCHEMA_VERSION,
  // 状態遷移規則
  transition,
  STATUS_FOR,
  outcomeOf,
  // エンティティ解決(名寄せ)
  resolveCompany,
  sameCompany,
  samePosition,
  addAlias,
  addPending,
  listPending,
  setOfficialName,
  // 読み書き
  upsertCompany,
  insertSelection,
  listSelections,
  listCompanies,
  getCompanyCredential,
  addEvent,
  listEvents,
  // 予定と冪等な突合
  addAppointment,
  listAppointments,
  sameAppointment,
  findAppointmentMatch,
  normalizeAppointmentAt,
  normalizeAppointmentUrl,
} from './db.js'
export type {
  Selection,
  SelectionRow,
  CompanyInfo,
  Stage,
  Resolution,
  Appointment,
  AppointmentLike,
  AppointmentMatch,
  AppointmentRow,
  EventRow,
} from './db.js'

// ---- 入力の共通処理 ----
export { resolveSelectionId, upsertPerson, transaction } from './inputs.js'

// ---- 書き込み層(冪等な反映) ----
export { applyDiff, MAX_APPLY_CHANGES } from './db-apply.js'
export type { DiffItem, ApplyResult } from './db-apply.js'
export { applyCalendar } from './db-apply-calendar.js'
export { applyInterview, savePersonPhoto } from './db-apply-interview.js'
export { applyCareerCalendar } from './db-apply-career-calendar.js'
export type { CareerCalendarCandidate, CareerCalendarInput, CareerCalendarResult } from './db-apply-career-calendar.js'

// ---- 就活エージェント・イベント運営者(応募企業とは分離) ----
export {
  ensureCareerSupportSchema,
  normalizeOrganizationAlias,
  upsertCareerOrganization,
  resolveCareerOrganization,
  upsertCareerMeeting,
  listCareerMeetings,
} from './career-support.js'
export type {
  CareerOrganizationKind,
  CareerMeetingStatus,
  CareerMeetingInput,
  CareerMeetingRow,
} from './career-support.js'

// ---- 応募の状態機械 ----
export {
  ensureApplicationSchema,
  startApplication,
  applyApplicationEvent,
  createApprovalToken,
  listApplicationRuns,
  listWebAssessments,
  listCalendarOutbox,
  linkCalendarAppointment,
} from './application.js'
export type {
  ApplicationState,
  ApplicationEventType,
  ApplicationMaterialInput,
  AssessmentInput,
  AppointmentInput,
  StartApplicationInput,
  ApplicationEventInput,
  ApplicationRunRow,
  CalendarOutboxRow,
  CalendarLinkInput,
} from './application.js'

// ---- 移動可能性 ----
export {
  upsertPlace,
  setMobilityProfile,
  setAppointmentMobility,
  upsertRouteEstimate,
  addTravelSegment,
  listMobilityData,
} from './mobility.js'
export type {
  PlaceKind,
  PlacePrivacy,
  AttendanceMode,
  MobilityStatus,
  TransportMode,
  TravelStatus,
  PlaceInput,
  MobilityProfileInput,
  AppointmentMobilityInput,
  RouteEstimateInput,
  TravelSegmentInput,
} from './mobility.js'

// ---- provider非依存のエージェント実行契約 ----
export {
  runAgent,
  createDefaultAdapters,
  createCodexAdapter,
  createClaudeAdapter,
  parseProviderOrder,
  classifyFailure,
  mayFallback,
  parseQuotaResetAt,
  validateJsonSchema,
  executeProcess,
  PROVIDER_IDS,
  DEFAULT_CODEX_WEB_SEARCH_ARGS,
  DEFAULT_CAPABILITY_TOOLS,
  DEFAULT_ABORT_PATTERNS,
} from './agent-runtime.js'
export type {
  ProviderId,
  AgentRisk,
  SideEffectMode,
  FailureCode,
  AgentRunRequest,
  AgentAdapter,
  AgentAttempt,
  AgentRunResult,
  RunAgentOptions,
  AdapterPaths,
  AdapterOptions,
  PreflightResult,
  ProcessInvocation,
  ProcessResult,
  ProcessExecutor,
  ProviderHealthEntry,
  ProviderHealthDocument,
} from './agent-runtime.js'

// ---- 会議URLの許可リスト ----
export { isMeetingUrl, MEETING_HOSTS, SHORTENER_HOSTS } from './meeting-url.js'

// ---- 人物・プロフィール・企業研究・メール ----
export {
  ensurePlatformSchema,
  listPlatformSnapshot,
  saveBasicProfile,
  getBasicProfile,
  upsertCompanyDossier,
  upsertMailItem,
  listActionableMail,
} from './platform.js'
export type { PlatformSnapshot, CompanyDossier, MailItemInput } from './platform.js'

// ---- 重複予定の検出 ----
export { findDuplicates } from './check-duplicate-appointments.js'
export type { DuplicatePair } from './check-duplicate-appointments.js'
