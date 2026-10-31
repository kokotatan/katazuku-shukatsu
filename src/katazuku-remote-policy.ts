export const KATAZUKU_REMOTE_SCOPES = [
  'katazuku:read',
  'katazuku:write',
  'katazuku:sensitive',
  'katazuku:actions',
] as const

export type KatazukuRemoteScope = typeof KATAZUKU_REMOTE_SCOPES[number]

export const KATAZUKU_REMOTE_TOOL_SCOPES = {
  katazuku_today: 'katazuku:read',
  katazuku_next: 'katazuku:read',
  katazuku_conflicts: 'katazuku:read',
  katazuku_status: 'katazuku:read',
  katazuku_availability: 'katazuku:read',
  katazuku_submissions: 'katazuku:read',
  katazuku_meeting_preparations: 'katazuku:read',
  katazuku_actionable_mail: 'katazuku:read',
  katazuku_snapshot: 'katazuku:sensitive',
  katazuku_meeting_preparation_context: 'katazuku:sensitive',
  katazuku_record_mail: 'katazuku:write',
  katazuku_record_submission: 'katazuku:write',
  katazuku_record_calendar: 'katazuku:write',
  katazuku_record_people_research: 'katazuku:write',
  katazuku_exclude_company: 'katazuku:write',
  katazuku_record_meeting_preparation: 'katazuku:write',
  katazuku_prepare_action: 'katazuku:actions',
  katazuku_action_status: 'katazuku:actions',
} as const satisfies Record<string, KatazukuRemoteScope>

export function localScopes(scopes: readonly string[]): ('read' | 'write' | 'sensitive' | 'actions')[] {
  return [...new Set(scopes
    .filter((scope): scope is KatazukuRemoteScope => KATAZUKU_REMOTE_SCOPES.includes(scope as KatazukuRemoteScope))
    .map((scope) => scope.slice('katazuku:'.length) as 'read' | 'write' | 'sensitive' | 'actions'))]
}

/** OAuth tokenのscopeとtoolの必要scopeをgatewayと端末側の両方で照合する。 */
export function allowedKatazukuRemoteRequest(value: unknown, scopes: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as { jsonrpc?: unknown; method?: unknown; params?: { name?: unknown } }
  if (message.jsonrpc !== '2.0') return false
  if (['initialize', 'ping', 'tools/list', 'notifications/initialized'].includes(String(message.method))) return true
  if (message.method !== 'tools/call' || typeof message.params?.name !== 'string') return false
  const required = KATAZUKU_REMOTE_TOOL_SCOPES[message.params.name as keyof typeof KATAZUKU_REMOTE_TOOL_SCOPES]
  return Boolean(required && scopes.includes(required))
}
