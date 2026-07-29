import { useState, type ComponentType } from 'react'
import {
  FaCalendarCheckIcon,
  FaChartLineIcon,
  FaCommentsIcon,
  FaEllipsisIcon,
  FaHouseIcon,
  FaIdCardIcon,
  FaInboxIcon,
  FaTableColumnsIcon,
  FaUsersIcon,
} from 'smarthr-ui'

/*
 * katazuku 共通サイドナビ。
 * このファイルは inbox/status/insight/profile/people/prep/impact の
 * src/components/AppNav.tsx で同一内容を保つこと(コピー同期)。
 * リンクは同一オリジンのパス前提(本番 katazuku.kotalabo.com)。
 * 開発サーバー(ポート別)ではアプリ間リンクは飛べないが仕様どおり。
 */

export type AppKey = 'home' | 'inbox' | 'status' | 'insight' | 'profile' | 'people' | 'prep' | 'impact'

type Item = {
  key: AppKey
  href: string
  label: string
  mobileLabel: string
  caption: string
  icon: ComponentType<{ className?: string }>
}

const ITEMS: Item[] = [
  { key: 'home', href: '/', label: 'ホーム', mobileLabel: 'ホーム', caption: '', icon: FaHouseIcon },
  { key: 'inbox', href: '/inbox/', label: 'メール', mobileLabel: 'メール', caption: 'Inbox', icon: FaInboxIcon },
  { key: 'status', href: '/status/', label: '選考管理', mobileLabel: '選考', caption: 'Status', icon: FaTableColumnsIcon },
  { key: 'insight', href: '/insight/', label: '今日やること', mobileLabel: '今日', caption: 'Insight', icon: FaCalendarCheckIcon },
  { key: 'profile', href: '/profile/', label: '個人マスタ', mobileLabel: 'マスタ', caption: 'Profile', icon: FaIdCardIcon },
  { key: 'people', href: '/people/', label: '人', mobileLabel: '人', caption: 'People', icon: FaUsersIcon },
  { key: 'prep', href: '/prep/', label: '面接準備', mobileLabel: '面接', caption: 'Prep', icon: FaCommentsIcon },
  { key: 'impact', href: '/impact/', label: '効果', mobileLabel: '効果', caption: 'Impact', icon: FaChartLineIcon },
]

// モバイル下タブは主要4つ+「その他」に絞る(タブは5つまで。8項目の横並びは触りにくい)
const MOBILE_PRIMARY: AppKey[] = ['home', 'inbox', 'status', 'insight']

function Brand() {
  return (
    <a href="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-teal-500 text-[15px] font-bold leading-none text-white"
      >
        片
      </span>
      <span className="text-lg font-bold tracking-tight text-slate-900">katazuku</span>
    </a>
  )
}

export function AppNav({ current }: { current: AppKey }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const primary = MOBILE_PRIMARY
    .map((key) => ITEMS.find((item) => item.key === key))
    .filter((item): item is Item => Boolean(item))
  const overflow = ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.key))
  const moreActive = overflow.some((item) => item.key === current)

  return (
    <>
      {/* デスクトップ: 左サイドバー */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-300 bg-white md:flex">
        <Brand />
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="katazuku アプリ">
          {ITEMS.map(({ key, href, label, caption, icon: Icon }) => {
            const active = key === current
            return (
              <a
                key={key}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-blue-50 font-bold text-blue-600'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className={active ? 'text-blue-600' : 'text-slate-500'}>
                  <Icon />
                </span>
                <span>{label}</span>
                {caption && (
                  <span className="ml-auto text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
                    {caption}
                  </span>
                )}
              </a>
            )
          })}
        </nav>
        <p className="px-5 py-4 text-[11px] leading-relaxed text-slate-400">
          就活を、ぜんぶ片付ける。
        </p>
      </aside>

      {/* モバイル: 「その他」ボトムシート */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="その他のアプリ">
          <button
            type="button"
            aria-label="閉じる"
            className="absolute inset-0 h-full w-full bg-slate-900/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-lg border-t border-slate-300 bg-white px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
            <p className="px-1 pb-3 text-xs font-bold text-slate-500">その他のアプリ</p>
            <div className="grid grid-cols-4 gap-2">
              {overflow.map(({ key, href, label, icon: Icon }) => {
                const active = key === current
                return (
                  <a
                    key={key}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className="flex flex-col items-center gap-1.5 py-1"
                  >
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-lg text-[20px] ${
                        active ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Icon />
                    </span>
                    <span className={`text-[11px] ${active ? 'font-bold text-blue-600' : 'text-slate-700'}`}>
                      {label}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* モバイル: 下タブバー(主要4+その他) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="katazuku アプリ"
      >
        <div className="flex">
          {primary.map(({ key, href, mobileLabel, icon: Icon }) => {
            const active = key === current
            return (
              <a
                key={key}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 pb-1.5 pt-2 text-[10px] ${
                  active ? 'font-bold text-blue-600' : 'text-slate-500'
                }`}
              >
                <span className="text-[20px] leading-none">
                  <Icon />
                </span>
                <span>{mobileLabel}</span>
              </a>
            )
          })}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className={`flex flex-1 flex-col items-center gap-1 pb-1.5 pt-2 text-[10px] ${
              moreActive || moreOpen ? 'font-bold text-blue-600' : 'text-slate-500'
            }`}
          >
            <span className="text-[20px] leading-none">
              <FaEllipsisIcon />
            </span>
            <span>その他</span>
          </button>
        </div>
      </nav>
    </>
  )
}
