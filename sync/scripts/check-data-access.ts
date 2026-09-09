import assert from 'node:assert/strict'
import { fetchKatazukuData, READ_KEY_STORAGE, ReadKeyError, saveReadKey, type KatazukuData } from '../../shared/src/index'
import { fetchAll, snapshotToAllData } from '../../board/src/lib/data'

// 認証前にはデータを返さず、認証APIの応答だけを表示する境界を検証する。
const storage = new Map<string, string>()
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} })
let checks = 0
function check(label: string, fn: () => void) {
  fn()
  checks++
  console.log(`OK ${label}`)
}

try {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('未入力では通信しない') }
  assert.equal(await fetchKatazukuData(), null)
  assert.equal(await fetchAll(), null)
  check('未入力ではAPI通信もデータ生成も行わない', () => {
    assert.equal(calls, 0)
    assert.equal(storage.size, 0)
  })

  const empty: KatazukuData = {
    generatedAt: '', companies: [], selections: [], appointments: [], events: [], enrichedEvents: [],
    activities: [], profile: {}, profileSuggestions: [], people: [], personNotes: [], interviews: [],
    submissions: [], dossiers: [], meetingRuns: [], mailItems: [],
  }
  saveReadKey(' fixture-key ')
  const controller = new AbortController()
  globalThis.fetch = async (input, options) => {
    calls++
    assert.equal(String(input), '/api/data?key=fixture-key')
    assert.equal(options?.signal, controller.signal)
    assert.equal(options?.cache, 'no-store')
    return Response.json(empty)
  }
  const data = await fetchKatazukuData(controller.signal)
  check('認証APIの空の応答にもレコードや件数を補わない', () => {
    assert.deepEqual(data, empty)
    assert.ok(data)
    assert.deepEqual(snapshotToAllData(data).tracks, [])
    assert.deepEqual([...storage.entries()], [[READ_KEY_STORAGE, 'fixture-key']])
  })

  globalThis.fetch = async () => new Response(null, { status: 401 })
  await assert.rejects(fetchKatazukuData(), ReadKeyError)
  check('合言葉の不一致で代替データを返さない', () => assert.equal(storage.size, 1))

  globalThis.fetch = async () => new Response(null, { status: 503 })
  await assert.rejects(fetchKatazukuData(), /503/)
  check('サーバー障害を認証成功にしない', () => assert.equal(storage.get(READ_KEY_STORAGE), 'fixture-key'))

  const aborted = new AbortController()
  aborted.abort()
  globalThis.fetch = async (_input, options) => { options?.signal?.throwIfAborted(); return Response.json(empty) }
  await assert.rejects(fetchKatazukuData(aborted.signal), { name: 'AbortError' })
  check('画面離脱や接続先変更で通信を中断できる', () => assert.equal(aborted.signal.aborted, true))

  saveReadKey('')
  globalThis.fetch = async () => { throw new Error('未入力では通信しない') }
  assert.equal(await fetchKatazukuData(), null)
  check('合言葉を消すとデータなしの状態へ戻る', () => assert.equal(storage.get(READ_KEY_STORAGE), ''))
  console.log(`データ閲覧・認証 ${checks}項目成功`)
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}
