import { useEffect, useMemo, useState } from 'react'
import { Input } from 'smarthr-ui'
import type { Email, RawEmail, Status } from './types'
import { classifyEmail } from './lib/classify'
import { makeDemoEmails } from './lib/demo'
import { fetchRecentEmails, requestAccessToken } from './lib/gmail'
import { addEmailToPipeline } from './lib/pipeline'
import { useLocalStorage } from './lib/storage'
import { AppNav } from './components/AppNav'
import { EmailCard } from './components/EmailCard'
import { Header } from './components/Header'
import { ReplyModal } from './components/ReplyModal'
import { Sidebar, type Filter } from './components/Sidebar'
import { SettingsModal } from './components/SettingsModal'

function freshDemo(): Email[] {
  const now = new Date()
  return makeDemoEmails(now).map((raw) => classifyEmail(raw, now))
}

/** スヌーズ期限が来たものは受信トレイ扱いにする */
function effectiveStatus(email: Email, now: Date): Status {
  if (email.status === 'snoozed' && email.snoozeUntil && new Date(email.snoozeUntil) <= now) {
    return 'inbox'
  }
  return email.status
}

function nextMorning(now: Date): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d
}

const DEADLINE_ASC = (a: Email, b: Email) => {
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline)
  if (a.deadline) return -1
  if (b.deadline) return 1
  return b.receivedAt.localeCompare(a.receivedAt)
}

const RECEIVED_DESC = (a: Email, b: Email) => b.receivedAt.localeCompare(a.receivedAt)

export default function App() {
  const [emails, setEmails] = useLocalStorage<Email[]>('katazuku-inbox/emails', freshDemo)
  const [clientId, setClientId] = useLocalStorage<string>('katazuku-inbox/gmail-client-id', () => '')
  const [filter, setFilter] = useState<Filter>('action')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Email | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      action: 0, selection: 0, all: 0, interview: 0, result: 0, task: 0, test: 0, event: 0, other: 0,
      snoozed: 0, done: 0,
    }
    for (const e of emails) {
      const status = effectiveStatus(e, now)
      if (status === 'inbox') {
        c.all++
        c[e.category]++
        if (e.needsAction) c.action++
        if (e.selectionKind === 'selection') c.selection++
      } else {
        c[status]++
      }
    }
    return c
  }, [emails, now])

  const visible = useMemo(() => {
    let list: Email[]
    switch (filter) {
      case 'action':
        list = emails
          .filter((e) => effectiveStatus(e, now) === 'inbox' && e.needsAction)
          .sort(DEADLINE_ASC)
        break
      case 'selection':
        list = emails
          .filter((e) => effectiveStatus(e, now) === 'inbox' && e.selectionKind === 'selection')
          .sort(DEADLINE_ASC)
        break
      case 'all':
        list = emails.filter((e) => effectiveStatus(e, now) === 'inbox').sort(RECEIVED_DESC)
        break
      case 'snoozed':
        list = emails.filter((e) => effectiveStatus(e, now) === 'snoozed').sort(DEADLINE_ASC)
        break
      case 'done':
        list = emails
          .filter((e) => e.status === 'done')
          .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
        break
      default:
        list = emails
          .filter((e) => effectiveStatus(e, now) === 'inbox' && e.category === filter)
          .sort(RECEIVED_DESC)
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((e) =>
      [e.subject, e.company, e.from, e.body].some((t) => t.toLowerCase().includes(q)),
    )
  }, [emails, filter, query, now])

  const patch = (id: string, p: Partial<Email>) =>
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...p } : e)))

  const markDone = (id: string) => {
    patch(id, { status: 'done', doneAt: new Date().toISOString(), snoozeUntil: null })
    setToast('片付けました')
  }
  const snooze = (id: string) => {
    patch(id, { status: 'snoozed', snoozeUntil: nextMorning(new Date()).toISOString() })
    setToast('明日の朝8時に戻ってきます')
  }
  const restore = (id: string) =>
    patch(id, { status: 'inbox', doneAt: null, snoozeUntil: null })

  const addToPipeline = (email: Email) => {
    const result = addEmailToPipeline(email)
    setToast(
      result.created
        ? `${result.name} を選考ボードに追加しました`
        : `${result.name} の次のアクションを選考ボードに反映しました`,
    )
  }

  /** 既存IDは状態(片付け済み等)を保ったまま、新着だけ追加する */
  const importRaws = (raws: RawEmail[]): number => {
    const known = new Set(emails.map((e) => e.id))
    const fresh = raws.filter((r) => !known.has(r.id)).map((r) => classifyEmail(r))
    setEmails((prev) => {
      const ids = new Set(prev.map((e) => e.id))
      return [...fresh.filter((f) => !ids.has(f.id)), ...prev]
    })
    return fresh.length
  }

  const connectGmail = async () => {
    if (!clientId.trim()) return
    setConnecting(true)
    try {
      const token = await requestAccessToken(clientId.trim())
      const raws = await fetchRecentEmails(token)
      const added = importRaws(raws)
      setToast(`Gmailから${raws.length}件取得、新着${added}件を取り込みました`)
      setSettingsOpen(false)
      setFilter('action')
    } catch (err) {
      setToast(`接続エラー: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setConnecting(false)
    }
  }

  const toRaws = (data: unknown): RawEmail[] => {
    if (!Array.isArray(data)) throw new Error('配列ではありません')
    return data.map((d, i) => ({
      id: String(d.id ?? `import-${Date.now()}-${i}`),
      from: String(d.from ?? ''),
      fromAddress: String(d.fromAddress ?? d.from_address ?? ''),
      subject: String(d.subject ?? '(件名なし)'),
      body: String(d.body ?? ''),
      receivedAt: String(d.receivedAt ?? d.received_at ?? new Date().toISOString()),
      source: 'import',
    }))
  }

  const importJson = (text: string) => {
    try {
      const raws = toRaws(JSON.parse(text))
      const added = importRaws(raws)
      setToast(`${raws.length}件中、新着${added}件を取り込みました`)
      setSettingsOpen(false)
    } catch (err) {
      setToast(`インポート失敗: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // public/gmail-import-auto.json があれば起動時に自動取込(ローカル運用向け・gitignore済み)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}gmail-import-auto.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data === null) return
        const added = importRaws(toRaws(data))
        // 実データが入ったらデモデータは引っ込める
        setEmails((prev) => prev.filter((e) => e.source !== 'demo'))
        if (added > 0) setToast(`メールデータから新着${added}件を自動取込しました`)
      })
      .catch(() => {
        // ファイルが無い・壊れている場合は何もしない
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(emails, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `katazuku-inbox-${now.toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const resetDemo = () => {
    if (window.confirm('現在のデータを消してデモデータに戻します。よろしいですか?')) {
      setEmails(freshDemo())
      setToast('デモデータをリセットしました')
      setSettingsOpen(false)
    }
  }

  // キーボードショートカット: J/K移動・Enter展開・E片付け・Sスヌーズ
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (settingsOpen) return
      const target = ev.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const idx = visible.findIndex((e) => e.id === selectedId)
      const move = (next: number) => {
        const email = visible[Math.max(0, Math.min(visible.length - 1, next))]
        if (email) {
          setSelectedId(email.id)
          document
            .querySelector(`[data-email-card="${email.id}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }
      switch (ev.key.toLowerCase()) {
        case 'j': move(idx < 0 ? 0 : idx + 1); break
        case 'k': move(idx < 0 ? 0 : idx - 1); break
        case 'enter':
          if (selectedId) setExpandedId((cur) => (cur === selectedId ? null : selectedId))
          break
        case 'e':
          if (selectedId) { markDone(selectedId); move(idx + 1) }
          break
        case 's':
          if (selectedId) { snooze(selectedId); move(idx + 1) }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const doneToday = emails.filter(
    (e) => e.doneAt && new Date(e.doneAt).toDateString() === now.toDateString(),
  ).length

  return (
    <div className="flex min-h-screen">
      <AppNav current="inbox" />
      <div className="min-h-screen min-w-0 flex-1 pb-14 md:pb-0">
      <Header
        doneToday={doneToday}
        doneTotal={counts.done}
        total={emails.length}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto flex max-w-6xl gap-6 px-6 py-6">
        <Sidebar filter={filter} counts={counts} onSelect={(f) => { setFilter(f); setSelectedId(null) }} />

        <section className="min-w-0 flex-1">
          <Input
            width="100%"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="企業名・件名・本文で検索"
            className="mb-4"
          />

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-300 bg-white py-20 text-center">
              {filter === 'action' && counts.action === 0 && !query ? (
                <>
                  <p className="text-2xl font-semibold tracking-wide text-slate-800">
                    全部、片付いた。
                  </p>
                  <p className="text-sm text-slate-400">この調子で見逃しゼロをキープしましょう</p>
                </>
              ) : (
                <p className="text-sm text-slate-400">
                  {query ? '検索に一致するメールはありません' : 'ここにはメールがありません'}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {visible.map((email) => (
                <EmailCard
                  key={email.id}
                  email={email}
                  now={now}
                  selected={email.id === selectedId}
                  expanded={email.id === expandedId}
                  onToggle={() => {
                    setSelectedId(email.id)
                    setExpandedId((cur) => (cur === email.id ? null : email.id))
                  }}
                  onDone={() => markDone(email.id)}
                  onSnooze={() => snooze(email.id)}
                  onRestore={() => restore(email.id)}
                  onAddToPipeline={() => addToPipeline(email)}
                  onReply={() => setReplyTarget(email)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {replyTarget && (
        <ReplyModal
          email={replyTarget}
          onClose={() => setReplyTarget(null)}
          onCopied={() => setToast('本文をコピーしました')}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          clientId={clientId}
          connecting={connecting}
          onSaveClientId={setClientId}
          onConnectGmail={connectGmail}
          onImportJson={importJson}
          onExportJson={exportJson}
          onResetDemo={resetDemo}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
      </div>
    </div>
  )
}
