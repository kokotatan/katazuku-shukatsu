import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fetchKatazukuData, type KatazukuData } from './index'
import { viewer } from './connection'

/** 接続先の変更、期限切れ、再読込の競合時に前のデータを表示しない。 */
export function useKatazukuData() {
  const connection = useSyncExternalStore(viewer.subscribe, viewer.getState)
  const [result, setResult] = useState<{ revision: number; data: KatazukuData | null; error: string; loading: boolean }>({ revision: -1, data: null, error: '', loading: false })
  const current = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    const revision = viewer.getState().revision
    if (!viewer.getState().connection) { setResult({ revision, data: null, error: '', loading: false }); return }
    setResult({ revision, data: null, error: '', loading: true })
    fetchKatazukuData(controller.signal).then(data => {
      if (!controller.signal.aborted && viewer.getState().revision === revision) setResult({ revision, data, error: '', loading: false })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && viewer.getState().revision === revision) setResult({ revision, data: null, error: reason instanceof Error ? reason.message : '接続できませんでした。', loading: false })
    })
  }, [])
  useEffect(() => { reload(); return () => current.current?.abort() }, [connection.revision, reload])
  // effectを待たず、切り替え直後のrenderから旧データを伏せる。
  const visible = result.revision === connection.revision && connection.connection
  return { data: visible ? result.data : null, error: visible ? result.error : '', loading: visible ? result.loading : false, reload }
}
