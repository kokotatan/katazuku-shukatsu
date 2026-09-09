import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchKatazukuData, getReadKey, ReadKeyError, saveReadKey, type KatazukuData } from '../../../shared/src/index'

export function useKatazukuData() {
  const [data, setData] = useState<KatazukuData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => Boolean(getReadKey()))
  const request = useRef<AbortController | null>(null)

  const reload = useCallback(() => {
    request.current?.abort()
    setError('')
    if (!getReadKey()) {
      setData(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    fetchKatazukuData(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setData(next) })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        if (reason instanceof ReadKeyError) setData(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    reload()
    return () => request.current?.abort()
  }, [reload])

  const setKey = (key: string) => {
    saveReadKey(key)
    // 接続先の切替中に以前の個人データを表示しない。
    setData(null)
    reload()
  }

  return { data, error, loading, reload, setKey }
}
