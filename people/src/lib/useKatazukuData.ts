import { useCallback, useEffect, useState } from 'react'
import { fetchKatazukuData, type KatazukuData } from '@katazuku/data'

/**
 * 本体では各アプリの src/lib/useKatazukuData.ts に同じ内容を置いている(コピー同期)。
 * 公開版もその構成を踏襲する。合言葉が無いぶん setKey は無い。
 */
export function useKatazukuData() {
  const [data, setData] = useState<KatazukuData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchKatazukuData(controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  useEffect(() => reload(), [reload])

  return { data, error, loading, reload }
}
