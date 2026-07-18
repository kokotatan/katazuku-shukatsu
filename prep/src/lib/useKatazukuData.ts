import { useCallback, useEffect, useState } from 'react'
import { fetchKatazukuData, saveReadKey, type KatazukuData } from '@katazuku/data'

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

  const setKey = (key: string) => {
    saveReadKey(key)
    reload()
  }

  return { data, error, loading, reload, setKey }
}
