import type { ComponentType } from 'react'
import {
  FaCalendarCheckIcon,
  FaChartLineIcon,
  FaCommentsIcon,
  FaHouseIcon,
  FaIdCardIcon,
  FaInboxIcon,
  FaTableColumnsIcon,
} from 'smarthr-ui'

/*
 * katazuku 共通サイドナビ。
 * このファイルは inbox/status/insight/profile/prep/impact の
 * src/components/AppNav.tsx で同一内容を保つこと(コピー同期)。
 * リンクは同一オリジンのパス前提(本番 katazuku.kotalabo.com)。
 * 開発サーバー(ポート別)ではアプリ間リンクは飛べないが仕様どおり。
 */

export type AppKey = 'home' | 'inbox' | 'status' | 'insight' | 'profile' | 'prep' | 'impact'

type Item = {
  key: AppKey
  href: string
  label: string
  caption: string
  icon: ComponentType<{ className?: string }>
}

const ITEMS: Item[] = [
  { key: 'home', href: '/', label: 'ホーム', caption: '', icon: FaHouseIcon },
  { key: 'inbox', href: '/inbox/', label: 'メール', caption: 'Inbox', icon: FaInboxIcon },
  { key: 'status', href: '/status/', label: '選考管理', caption: 'Status', icon: FaTableColumnsIcon },
  { key: 'insight', href: '/insight/', label: '今日やること', caption: 'Insight', icon: FaCalendarCheckIcon },
  { key: 'profile', href: '/profile/', label: '個人マスタ', caption: 'Profile', icon: FaIdCardIcon },
  { key: 'prep', href: '/prep/', label: '面接準備', caption: 'Prep', icon: FaCommentsIcon },
  { key: 'impact', href: '/impact/', label: '効果', caption: 'Impact', icon: FaChartLineIcon },
]

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

      {/* モバイル: 下タブバー */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-300 bg-white md:hidden"
        aria-label="katazuku アプリ"
      >
        {ITEMS.map(({ key, href, label, icon: Icon }) => {
          const active = key === current
          return (
            <a
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? 'font-bold text-blue-600' : 'text-slate-500'
              }`}
            >
              <Icon />
              <span>{label}</span>
            </a>
          )
        })}
      </nav>
    </>
  )
}
