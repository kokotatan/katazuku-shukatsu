import { createContext, useContext, useState, useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import {
  Cluster, FaCalendarCheckIcon, FaChartLineIcon, FaCommentsIcon, FaEllipsisIcon,
  FaHouseIcon, FaIdCardIcon, FaInboxIcon, FaTableColumnsIcon, FaUsersIcon,
  Heading, Stack, Text,
} from 'smarthr-ui'
import './app-shell.css'
import { ConnectionPanel, ConnectionStatus } from './ConnectionPanel'
import { LayoutOutline } from './layout-outline'
import { viewer } from './connection'
const AppContext = createContext<AppKey>('board')

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
  icon: ComponentType<{ className?: string }>
}

/**
 * リンクは兄弟ディレクトリへの相対パス。組み立てて1か所に並べたときに繋がる。
 * 開発サーバー(アプリごとに別ポート)ではアプリ間リンクは飛べない — 本体と同じ制約。
 */
const ITEMS: Item[] = [
  { key: 'board', href: '../board/', label: 'ホーム', mobileLabel: 'ホーム', caption: 'Board', icon: FaHouseIcon },
  { key: 'inbox', href: '../inbox/', label: 'メール', mobileLabel: 'メール', caption: 'Inbox', icon: FaInboxIcon },
  { key: 'status', href: '../status/', label: '選考管理', mobileLabel: '選考', caption: 'Status', icon: FaTableColumnsIcon },
  { key: 'insight', href: '../insight/', label: '今日やること', mobileLabel: '今日', caption: 'Insight', icon: FaCalendarCheckIcon },
  { key: 'profile', href: '../profile/', label: '個人マスタ', mobileLabel: 'マスタ', caption: 'Profile', icon: FaIdCardIcon },
  { key: 'people', href: '../people/', label: '人', mobileLabel: '人', caption: 'People', icon: FaUsersIcon },
  { key: 'prep', href: '../prep/', label: '面接準備', mobileLabel: '面接', caption: 'Prep', icon: FaCommentsIcon },
  { key: 'impact', href: '../impact/', label: '効果', mobileLabel: '効果', caption: 'Impact', icon: FaChartLineIcon },
]

// モバイル下タブは主要4つ+「その他」に絞る(タブは5つまで。8項目の横並びは触りにくい)
const MOBILE_PRIMARY: AppKey[] = ['board', 'inbox', 'status', 'insight']

export function AppNav({ current }: { current: AppKey }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (moreOpen) moreDialog.current?.showModal()
    else moreDialog.current?.close()
  }, [moreOpen])
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 768) setMoreOpen(false) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
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
          <img aria-hidden className="ktz-mark" src="./icons/necktie-192.png" alt="" />
          <span className="ktz-brand-name">katazuku 就活</span>
        </a>
        <nav className="ktz-side-nav" aria-label="katazuku アプリ">
          {ITEMS.map(({ key, href, label, icon: Icon }) => (
            <a
              key={key}
              href={href}
              aria-current={key === current ? 'page' : undefined}
              className={`ktz-side-link${key === current ? ' is-current' : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <p className="ktz-side-foot">就活を、ぜんぶ片付ける。</p>
      </aside>

      {/* モバイル: 「その他」ボトムシート */}
        <dialog ref={moreDialog} className="ktz-sheet" aria-label="その他のアプリ" onCancel={() => setMoreOpen(false)} onClose={() => setMoreOpen(false)}>
          <div className="ktz-sheet-body">
            <p className="ktz-sheet-title">その他のアプリ</p>
            <button className="ktz-reload" type="button" onClick={() => setMoreOpen(false)}>閉じる</button>
            <div className="ktz-sheet-grid">
              {overflow.map(({ key, href, label, icon: Icon }) => (
                <a key={key} href={href} aria-current={key === current ? 'page' : undefined} className="ktz-sheet-item">
                  <span className={`ktz-sheet-icon${key === current ? ' is-current' : ''}`}><Icon /></span>
                  <span>{label}</span>
                </a>
              ))}
            </div>
          </div>
        </dialog>

      {/* モバイル: 下タブバー(主要4+その他) */}
      <nav className="ktz-tabbar" aria-label="katazuku アプリ">
        {primary.map(({ key, href, mobileLabel, icon: Icon }) => (
          <a
            key={key}
            href={href}
            aria-current={key === current ? 'page' : undefined}
            className={`ktz-tab${key === current ? ' is-current' : ''}`}
          >
            <Icon />
            <span>{mobileLabel}</span>
          </a>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className={`ktz-tab${moreActive || moreOpen ? ' is-current' : ''}`}
        >
          <FaEllipsisIcon />
          <span>その他</span>
        </button>
      </nav>
    </>
  )
}

export function DataState({ loading, error }: { loading: boolean; error: string }) {
  const view = useContext(AppContext)
  return <section className="access-state" aria-label="PCとの連携">
    <div className="access-layout" aria-hidden="true" inert><LayoutOutline view={view} /></div>
    <div className="access-entry"><ConnectionPanel loading={loading} error={error} onReload={() => viewer.refresh()} /></div>
  </section>
}

/** 各アプリの見出しと、内容を説明する一文。 */
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
        <Heading type="blockTitle">{title}</Heading>
        <Text size="S" color="TEXT_GREY">{description}</Text>
      </Stack>
      <Cluster align="center" gap={0.5}>
        {generatedAt && (
          <Text size="S" color="TEXT_GREY">
            最終更新 {new Date(generatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
        <ReloadButton onReload={onReload} loading={loading} />
      </Cluster>
    </Cluster>
  )
}

function ReloadButton({ onReload, loading }: { onReload: () => void; loading: boolean }) {
  return (
    <button type="button" className="ktz-reload" onClick={onReload} disabled={loading}>
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
export function AppShell({ current, children }: { current: AppKey; children: ReactNode }) {
  useEffect(() => { document.title = `${ITEMS.find(item => item.key === current)?.label || 'ホーム'} | katazuku 就活` }, [current])
  return (
    <AppContext.Provider value={current}><div className="ktz-app">
      <AppNav current={current} />
      <main className="ktz-main">
        <Stack gap={1.5}><ConnectionStatus />{children}</Stack>
      </main>
    </div></AppContext.Provider>
  )
}
