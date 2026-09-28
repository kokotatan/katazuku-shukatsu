/** スマホに公開する操作。就活DBの読み取り4つと依頼3つ。worker用claim/reportと管理用操作は公開しない。 */
export const SPARK_REMOTE_TOOLS = ['katazuku_today', 'katazuku_next', 'katazuku_conflicts', 'katazuku_status', 'spark_enqueue', 'spark_status', 'spark_list'] as const
export function allowedSparkRemoteRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const m = value as { jsonrpc?: unknown; method?: unknown; params?: { name?: unknown } }
  if (m.jsonrpc !== '2.0') return false
  if (['initialize', 'ping', 'tools/list', 'notifications/initialized'].includes(String(m.method))) return true
  return m.method === 'tools/call' && SPARK_REMOTE_TOOLS.includes(m.params?.name as typeof SPARK_REMOTE_TOOLS[number])
}
export function filterSparkRemoteResponse(value: unknown): unknown {
  const response = value as { result?: { tools?: { name: string }[] } } | undefined
  if (response?.result?.tools) response.result.tools = response.result.tools.filter(t => SPARK_REMOTE_TOOLS.includes(t.name as typeof SPARK_REMOTE_TOOLS[number]))
  return value
}
