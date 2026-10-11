import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Center, Cluster, Heading, InformationPanel, Loader, Stack, Text } from './viewer-components'
import './app-shell.css'

/**
 * アプリ群の共通シェル(ナビ・見出し・読み込み状態)。
 *
 * 本体では同じ内容の AppNav.tsx を各アプリへコピーして同期していた
 * (ファイル冒頭に「コピー同期すること」と書いてある)。公開版はここに1つだけ置く。
 * アプリを増やすたびに8ファイル直す、という手作業をOSSへ持ち込まないため。
 */

export type AppKey = 'board' | 'inbox' | 'status' | 'insight' | 'profile' | 'people' | 'prep' | 'impact'

type Item = {
  key: AppKey
  href: string
  label: string
  mobileLabel: string
  caption: string
  icon: AppKey
}

/**
 * リンクは兄弟ディレクトリへの相対パス。組み立てて1か所に並べたときに繋がる。
 * `npm start` / `npm run demo` では8アプリを同じローカルサーバーから配信する。
 * 個別のVite開発サーバーではアプリ間リンクは使わない。
 */
const ITEMS: Item[] = [
  { key: 'board', href: '../board/', label: 'ボード', mobileLabel: 'ボード', caption: 'Board', icon: 'board' },
  { key: 'inbox', href: '../inbox/', label: 'メール', mobileLabel: 'メール', caption: 'Inbox', icon: 'inbox' },
  { key: 'status', href: '../status/', label: '選考管理', mobileLabel: '選考', caption: 'Status', icon: 'status' },
  { key: 'insight', href: '../insight/', label: '今日やること', mobileLabel: '今日', caption: 'Insight', icon: 'insight' },
  { key: 'profile', href: '../profile/', label: '個人マスタ', mobileLabel: 'マスタ', caption: 'Profile', icon: 'profile' },
  { key: 'people', href: '../people/', label: '人', mobileLabel: '人', caption: 'People', icon: 'people' },
  { key: 'prep', href: '../prep/', label: '面接準備', mobileLabel: '面接', caption: 'Prep', icon: 'prep' },
  { key: 'impact', href: '../impact/', label: '効果', mobileLabel: '効果', caption: 'Impact', icon: 'impact' },
]

function AppIcon({ name }: { name: AppKey | 'more' }) {
  const paths: Record<AppKey | 'more', ReactNode> = {
    board: <><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
    inbox: <><path d="M4 4h16v12h-5l-2 3h-2l-2-3H4z"/><path d="M4 16v4h16v-4"/></>,
    status: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 4v16"/></>,
    insight: <><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4m-8 8 2 2 5-5"/></>,
    profile: <><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="M5 17c0-3 8-3 8 0m2-7h4m-4 4h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-6 12-6 12 0m3-11a3 3 0 0 1 0 6m0 2c2 0 3 1 3 3"/></>,
    prep: <><path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8m-8 3h5"/></>,
    impact: <><path d="M4 20h16M6 17v-4m6 4V8m6 9V4"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

// モバイル下タブは主要4つ+「その他」に絞る(タブは5つまで。8項目の横並びは触りにくい)
const MOBILE_PRIMARY: AppKey[] = ['board', 'inbox', 'status', 'insight']

export function AppNav({ current }: { current: AppKey }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButton = useRef<HTMLButtonElement>(null)
  const sheetBody = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (moreOpen) sheetBody.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus()
  }, [moreOpen])
  const closeMore = () => {
    setMoreOpen(false)
    moreButton.current?.focus()
  }
  const onSheetKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMore(); return }
    if (event.key !== 'Tab') return
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]'))
    if (!links.length) return
    if (event.shiftKey && document.activeElement === links[0]) { event.preventDefault(); links.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === links.at(-1)) { event.preventDefault(); links[0].focus() }
  }
  const primary = MOBILE_PRIMARY
    .map((key) => ITEMS.find((item) => item.key === key))
    .filter((item): item is Item => Boolean(item))
  const overflow = ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.key))
  const moreActive = overflow.some((item) => item.key === current)

  return (
    <>
      {/* デスクトップ: 左サイドバー */}
      <aside className="ktz-side">
        <a className="ktz-brand" href="../board/">
          <span aria-hidden className="ktz-mark">片</span>
          <span className="ktz-brand-name">katazuku</span>
        </a>
        <nav className="ktz-side-nav" aria-label="katazuku アプリ">
          {ITEMS.map(({ key, href, label, caption, icon }) => (
            <a
              key={key}
              href={href}
              aria-current={key === current ? 'page' : undefined}
              className={`ktz-side-link${key === current ? ' is-current' : ''}`}
            >
              <AppIcon name={icon} />
              <span>{label}</span>
              <span className="ktz-caption">{caption}</span>
            </a>
          ))}
        </nav>
        <p className="ktz-side-foot"><a href="../">はじめる・朝のまとめ</a></p>
      </aside>

      {/* モバイル: 「その他」ボトムシート */}
      {moreOpen && (
        <div className="ktz-sheet" role="dialog" aria-modal="true" aria-label="その他のアプリ">
          <button type="button" aria-label="閉じる" className="ktz-sheet-scrim" onClick={closeMore} tabIndex={-1} />
          <div className="ktz-sheet-body" ref={sheetBody} onKeyDown={onSheetKeyDown}>
            <p className="ktz-sheet-title">その他のアプリ</p>
            <div className="ktz-sheet-grid">
              {overflow.map(({ key, href, label, icon }) => (
                <a key={key} href={href} aria-current={key === current ? 'page' : undefined} className="ktz-sheet-item">
                  <span className={`ktz-sheet-icon${key === current ? ' is-current' : ''}`}><AppIcon name={icon} /></span>
                  <span>{label}</span>
                </a>
              ))}
            </div>
            <p className="ktz-side-foot"><a href="../">はじめる・朝のまとめ</a></p>
          </div>
        </div>
      )}

      {/* モバイル: 下タブバー(主要4+その他) */}
      <nav className="ktz-tabbar" aria-label="katazuku アプリ">
        {primary.map(({ key, href, mobileLabel, icon }) => (
          <a
            key={key}
            href={href}
            aria-current={key === current ? 'page' : undefined}
            className={`ktz-tab${key === current ? ' is-current' : ''}`}
          >
            <AppIcon name={icon} />
            <span>{mobileLabel}</span>
          </a>
        ))}
        <button
          type="button"
          ref={moreButton}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className={`ktz-tab${moreActive || moreOpen ? ' is-current' : ''}`}
        >
          <AppIcon name="more" />
          <span>その他</span>
        </button>
      </nav>
    </>
  )
}

/**
 * 読み込み中・失敗の表示。
 * 本体はここで閲覧用の合言葉を入力させるが、公開版はローカルのファイルを読むだけなので
 * 入力欄が要らない。代わりにスナップショットの作り方を案内する。
 */
export function DataState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) {
    return <Center><Loader text="正本DBのスナップショットを読み込んでいます" /></Center>
  }
  return (
    <InformationPanel type="error" heading="データを読み込めません" toggleable={false}>
      <Stack gap={0.5}>
        <Text>{error || 'スナップショットが見つかりません。'}</Text>
        <Text size="S" color="TEXT_GREY">
          自分のデータにはセットアップと日次同期が必要です。<a href="../">はじめる</a>で手順を確認してください。
          架空データを試す場合は、リポジトリのルートで <code>npm run demo</code> を実行します。
        </Text>
      </Stack>
    </InformationPanel>
  )
}

/** 各アプリの見出し。本体の「英字キャプション + タイトル + 一文」を踏襲する */
export function AppHeading({
  caption, title, description, generatedAt, onReload, loading,
}: {
  caption: string
  title: string
  description: string
  generatedAt?: string
  onReload: () => void
  loading: boolean
}) {
  return (
    <Cluster align="flex-end" justify="space-between" gap={1}>
      <Stack gap={0.25}>
        <Text size="S" weight="bold" color="TEXT_LINK">{caption}</Text>
        <Heading type="blockTitle">{title}</Heading>
        <Text size="S" color="TEXT_GREY">{description}</Text>
      </Stack>
      <Cluster align="center" gap={0.5}>
        {generatedAt && (
          <Text size="S" color="TEXT_GREY">
            DB {new Date(generatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 時点
          </Text>
        )}
        <ReloadButton onReload={onReload} loading={loading} />
      </Cluster>
    </Cluster>
  )
}

function ReloadButton({ onReload, loading }: { onReload: () => void; loading: boolean }) {
  return (
    <button type="button" className="ktz-reload dads-button" data-type="outline" data-size="md" onClick={onReload} disabled={loading}>
      {loading ? '読込中…' : '再読込'}
    </button>
  )
}

/** 数値タイル。status / impact / inbox が同じ形で使う */
export function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' }) {
  return (
    <div className="ktz-tile">
      <Text size="S" color="TEXT_GREY">{label}</Text>
      <Text size="XL" weight="bold" color={tone === 'danger' ? 'DANGER' : 'TEXT_BLACK'}>{value}</Text>
    </div>
  )
}

/** アプリの外枠(サイドバー + 本文)。全アプリで同じ */
export function AppShell({ current, children, demo, refreshError }: { current: AppKey; children: ReactNode; demo?: boolean; refreshError?: string }) {
  return (
    <div className="ktz-app"><a className="ktz-skip" href="#main-content">本文へ移動</a>
      <AppNav current={current} />
      <main className="ktz-main" id="main-content" tabIndex={-1}>
        <Stack gap={1.5}>
          {demo && <InformationPanel type="warning" heading="架空データのデモです" toggleable={false}>
            <Text>実際の予定や選考状況ではありません。自分のデータを開くときは <code>npm start</code> を使ってください。</Text>
          </InformationPanel>}
          {refreshError && <InformationPanel type="warning" heading="再読込に失敗しました" toggleable={false}>
            <Text>表示している内容は、最後に取得できた時点のものです。最新の予定や選考状況はまだ確認できていません。接続と同期を確認し、もう一度「再読込」を押してください。</Text>
          </InformationPanel>}
          {children}
        </Stack>
      </main>
    </div>
  )
}
