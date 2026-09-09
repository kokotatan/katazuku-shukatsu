import { useRef, useState, type ComponentType } from 'react'
import { FaCalendarCheckIcon, FaChartLineIcon, FaCommentsIcon, FaEllipsisIcon, FaHouseIcon, FaIdCardIcon, FaInboxIcon, FaTableColumnsIcon, FaUsersIcon } from 'smarthr-ui'

/** 共通ナビ。7アプリの同名ファイルをコピー同期する。 */
export type AppKey = 'home' | 'inbox' | 'status' | 'insight' | 'profile' | 'people' | 'prep' | 'impact'
type Item = { key: AppKey; href: string; label: string; icon: ComponentType<{ className?: string }> }
const ITEMS: Item[] = [
  { key: 'insight', href: '/insight/', label: '今日', icon: FaCalendarCheckIcon },
  { key: 'prep', href: '/prep/', label: '企業研究', icon: FaCommentsIcon },
  { key: 'people', href: '/people/', label: '人', icon: FaUsersIcon },
  { key: 'inbox', href: '/inbox/', label: 'メール', icon: FaInboxIcon },
  { key: 'status', href: '/status/', label: '選考', icon: FaTableColumnsIcon },
  { key: 'profile', href: '/profile/', label: '自分の情報', icon: FaIdCardIcon },
  { key: 'impact', href: '/impact/', label: '活動記録', icon: FaChartLineIcon },
  { key: 'home', href: '/', label: 'ホーム', icon: FaHouseIcon },
]
const PRIMARY = ITEMS.slice(0, 4)
const OTHER = ITEMS.slice(4)

function Brand() {
  return <a href="/" className="flex items-center gap-2"><img src="/icons/necktie-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0" /><span className="text-lg font-bold text-slate-900">katazuku</span></a>
}

export function AppNav({ current }: { current: AppKey }) {
  const menu = useRef<HTMLDialogElement>(null)
  const guide = useRef<HTMLDialogElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const otherActive = OTHER.some(item => item.key === current)
  const openGuide = () => { menu.current?.close(); guide.current?.showModal() }
  return <>
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50 md:flex">
      <div className="px-5 py-5"><Brand /></div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="メインメニュー">
        {ITEMS.map(({ key, href, label, icon: Icon }) => <a key={key} href={href} aria-current={key === current ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 border-l-2 border-transparent px-3 text-sm ${key === current ? 'border-l-blue-500 bg-slate-100 font-semibold text-blue-600' : 'text-slate-700 hover:bg-slate-100'}`}><span aria-hidden="true"><Icon /></span>{label}</a>)}
      </nav>
      <div className="border-t border-slate-200 px-5 py-4"><button type="button" onClick={openGuide} className="min-h-11 text-sm text-slate-700 hover:text-blue-600">使い方</button><p className="mt-2 text-xs text-slate-500">Kotaro Design Lab.</p></div>
    </aside>

    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-2 pt-[max(8px,env(safe-area-inset-top))] md:hidden"><Brand /><button type="button" onClick={openGuide} className="min-h-11 px-2 text-sm text-slate-600">使い方</button></header>

    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="メインメニュー">
      <div className="flex px-2 pt-1">
        {PRIMARY.map(({ key, href, label, icon: Icon }) => <a key={key} href={href} aria-current={key === current ? 'page' : undefined} className={`flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 pb-2 text-xs ${key === current ? 'font-bold text-blue-600' : 'text-slate-600'}`}><span aria-hidden="true" className={`flex h-7 w-12 items-center justify-center text-xl ${key === current ? 'text-blue-600' : ''}`}><Icon /></span>{label}</a>)}
        <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => { menu.current?.showModal(); setMoreOpen(true) }} className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 pb-2 text-xs ${otherActive || moreOpen ? 'font-bold text-blue-600' : 'text-slate-600'}`}><span aria-hidden="true" className={`flex h-7 w-12 items-center justify-center text-xl ${otherActive || moreOpen ? 'text-blue-600' : ''}`}><FaEllipsisIcon /></span>その他</button>
      </div>
    </nav>

    <dialog ref={menu} onClose={() => setMoreOpen(false)} onClick={event => { if (event.target === event.currentTarget) menu.current?.close() }} className="app-dialog app-sheet" aria-labelledby="more-title">
      <div className="p-5"><div className="mb-3 flex items-center justify-between"><h2 id="more-title" className="font-bold">その他</h2><button type="button" onClick={() => menu.current?.close()} className="min-h-11 px-3 text-sm text-blue-600">閉じる</button></div>
        <nav aria-label="その他のメニュー" className="flex flex-col gap-1">{OTHER.map(({ key, href, label, icon: Icon }) => <a key={key} href={href} aria-current={key === current ? 'page' : undefined} className={`flex min-h-14 items-center gap-3 border-l-2 border-transparent px-3 text-sm ${key === current ? 'border-l-blue-500 bg-slate-100 font-semibold text-blue-600' : 'text-slate-700 hover:bg-slate-100'}`}><span aria-hidden="true"><Icon /></span>{label}</a>)}</nav>
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3"><button type="button" onClick={openGuide} className="min-h-11 text-sm text-blue-600">使い方</button><span className="text-xs text-slate-500">Kotaro Design Lab.</span></div>
      </div>
    </dialog>

    <dialog ref={guide} onClick={event => { if (event.target === event.currentTarget) guide.current?.close() }} className="app-dialog" aria-labelledby="guide-title">
      <div className="p-6"><div className="flex items-center justify-between gap-4"><h2 id="guide-title" className="text-lg font-bold">使い方</h2><button type="button" onClick={() => guide.current?.close()} className="min-h-11 px-2 text-sm text-blue-600">閉じる</button></div>
        <ol className="mt-3 space-y-5 text-sm leading-7"><li><a href="/prep/" className="font-bold text-blue-600">企業研究</a><p>会社を選び、事業・調査資料・過去の面接を確認します。</p></li><li><a href="/people/" className="font-bold text-blue-600">人</a><p>顔と名前から、会った場面や話したことを振り返ります。</p></li><li><a href="/insight/" className="font-bold text-blue-600">今日</a><p>次の予定と締切を確認。選考や自分の情報は「その他」から開けます。</p></li></ol>
      </div>
    </dialog>
  </>
}
