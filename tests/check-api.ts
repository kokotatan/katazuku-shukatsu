/**
 * 公開API面(src/index.ts)の見張り。
 *
 * 公開面は SemVer の約束そのものなので、うっかり増減しないようにここで固定する。
 * 名前を増やしたら EXPECTED に足す(=意図的な公開)。内部ヘルパーが漏れたら FORBIDDEN で落ちる。
 *   npm run test:api
 */
import * as api from '../src/index.js'

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

/** 公開する値(型は実行時に見えないのでここでは扱わない) */
const EXPECTED = [
  // db
  'openDb', 'SCHEMA_VERSION', 'transition', 'STATUS_FOR', 'outcomeOf',
  'resolveCompany', 'sameCompany', 'samePosition', 'addAlias', 'addPending', 'listPending', 'setOfficialName',
  'upsertCompany', 'insertSelection', 'listSelections', 'listCompanies', 'addEvent', 'listEvents',
  'addAppointment', 'listAppointments', 'sameAppointment', 'findAppointmentMatch',
  'normalizeAppointmentAt', 'normalizeAppointmentUrl',
  // inputs
  'resolveSelectionId', 'upsertPerson', 'transaction',
  // 書き込み層
  'applyDiff', 'MAX_APPLY_CHANGES', 'applyCalendar', 'applyInterview', 'savePersonPhoto',
  // 応募の状態機械
  'ensureApplicationSchema', 'startApplication', 'applyApplicationEvent', 'listApplicationRuns',
  'listWebAssessments', 'listCalendarOutbox', 'linkCalendarAppointment',
  // 移動
  'upsertPlace', 'setMobilityProfile', 'setAppointmentMobility', 'upsertRouteEstimate',
  'addTravelSegment', 'listMobilityData',
  // agent runtime
  'runAgent', 'createDefaultAdapters', 'createCodexAdapter', 'createClaudeAdapter',
  'parseProviderOrder', 'classifyFailure', 'mayFallback', 'parseQuotaResetAt', 'validateJsonSchema',
  'executeProcess', 'PROVIDER_IDS', 'DEFAULT_CODEX_WEB_SEARCH_ARGS',
  'DEFAULT_CAPABILITY_TOOLS', 'DEFAULT_ABORT_PATTERNS',
  // 会議URL
  'isMeetingUrl', 'MEETING_HOSTS', 'SHORTENER_HOSTS',
  // platform
  'ensurePlatformSchema', 'listPlatformSnapshot', 'saveBasicProfile', 'getBasicProfile',
  'upsertCompanyDossier', 'upsertMailItem', 'listActionableMail',
  // 重複検出
  'findDuplicates',
].sort()

/** 内部実装。公開面から漏れていたら落とす */
const FORBIDDEN = [
  'normalize', 'normalizeSurface', 'designatorsOf', 'designatorsConflict', 'rank',
  'commandPreview', 'detectProcessFailure', 'resolveProviderCommands',
  'detectCodexExtraCapabilities', 'parseWebSearchArgs', 'addColumn', 'parseJson', 'stripImages',
]

const actual = Object.keys(api).sort()

const missing = EXPECTED.filter((n) => !actual.includes(n))
check('公開すると宣言した名前がすべて出ている', missing.length === 0, `欠落: ${missing.join(', ')}`)

const extra = actual.filter((n) => !EXPECTED.includes(n))
check('宣言していない名前が公開面に混ざっていない', extra.length === 0,
  `未宣言: ${extra.join(', ')}(意図的な追加なら tests/check-api.ts の EXPECTED に足す)`)

const leaked = FORBIDDEN.filter((n) => actual.includes(n))
check('内部ヘルパーが公開面へ漏れていない', leaked.length === 0, `漏洩: ${leaked.join(', ')}`)

check('入口が実際に呼べる(スモーク)', typeof api.openDb === 'function' && typeof api.transition === 'function')
check('SCHEMA_VERSION は正の整数', Number.isInteger(api.SCHEMA_VERSION) && api.SCHEMA_VERSION > 0)

console.log(`\n公開面: ${actual.length} 名`)
if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('すべて通過')
