import { useState } from 'react'
import type { Company } from '../types'
import { requestAccessToken } from '../lib/google'
import { applyPlan, fetchGrid, planUpdates, type SheetGrid, type SyncPlan } from '../lib/sheet'

interface Props {
  companies: Company[]
  clientId: string
  sheetId: string
  onSaveSettings: (clientId: string, sheetId: string) => void
  onDone: (message: string) => void
  onClose: () => void
}

type Phase =
  | { step: 'setup' }
  | { step: 'loading'; label: string }
  | { step: 'confirm'; plan: SyncPlan; grid: SheetGrid; token: string }
  | { step: 'error'; message: string }

export function SheetSyncModal({ companies, clientId, sheetId, onSaveSettings, onDone, onClose }: Props) {
  const [cid, setCid] = useState(clientId)
  const [sid, setSid] = useState(sheetId)
  const [phase, setPhase] = useState<Phase>({ step: 'setup' })

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  const makePlan = async () => {
    onSaveSettings(cid.trim(), sid.trim())
    setPhase({ step: 'loading', label: 'Googleにサインインしています…' })
    try {
      const token = await requestAccessToken(cid.trim())
      setPhase({ step: 'loading', label: 'シートを読み込んでいます…' })
      const grid = await fetchGrid(token, sid.trim())
      const plan = planUpdates(companies, grid.rows, grid.table)
      setPhase({ step: 'confirm', plan, grid, token })
    } catch (err) {
      setPhase({ step: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const apply = async () => {
    if (phase.step !== 'confirm') return
    const { plan, grid, token } = phase
    setPhase({ step: 'loading', label: 'シートに書き込んでいます…' })
    try {
      await applyPlan(token, sid.trim(), grid.tabTitle, plan.updates)
      onDone(
        `シートに反映しました(更新 ${plan.updatedNames.length}社 / 追記 ${plan.addedNames.length}社)`,
      )
    } catch (err) {
      setPhase({ step: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">選考管理シートに反映</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {phase.step === 'setup' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-slate-500">
              ボードを正として、シートの「出願状況・次回アクション・〆切」を更新し、シートに無い企業を空き行に追記します。
              合格/不合格などの確定済みの状況・メモ欄・選考フロー列には触れません。書き込み前に差分を確認できます。
            </p>
            <label className="text-xs font-semibold text-slate-500">
              Google OAuth クライアントID *
              <input value={cid} onChange={(e) => setCid(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="xxxx.apps.googleusercontent.com" />
            </label>
            <label className="text-xs font-semibold text-slate-500">
              スプレッドシートID
              <input value={sid} onChange={(e) => setSid(e.target.value)} className={`mt-1 ${inputCls}`} />
            </label>
            <button
              onClick={makePlan}
              disabled={!cid.trim() || !sid.trim()}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              サインインして差分を確認
            </button>
          </div>
        )}

        {phase.step === 'loading' && (
          <p className="py-8 text-center text-sm text-slate-500">{phase.label}</p>
        )}

        {phase.step === 'confirm' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              タブ「{phase.grid.tabTitle}」に対して
              <b className="text-slate-800"> {phase.plan.updates.length}セル</b> を書き込みます。
            </p>
            {phase.plan.updatedNames.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 font-bold">更新 {phase.plan.updatedNames.length}社</p>
                <p className="leading-relaxed">{phase.plan.updatedNames.join('、')}</p>
              </div>
            )}
            {phase.plan.addedNames.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 font-bold">追記 {phase.plan.addedNames.length}社</p>
                <p className="leading-relaxed">{phase.plan.addedNames.join('、')}</p>
              </div>
            )}
            {phase.plan.skipped.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
                <p className="mb-1 font-bold">空き行不足で追記できない {phase.plan.skipped.length}社</p>
                <p className="leading-relaxed">{phase.plan.skipped.join('、')}</p>
              </div>
            )}
            {phase.plan.updates.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-500">
                差分はありません。シートは最新です
              </p>
            ) : (
              <button
                onClick={apply}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                この内容でシートに書き込む
              </button>
            )}
          </div>
        )}

        {phase.step === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{phase.message}</p>
            <button
              onClick={() => setPhase({ step: 'setup' })}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              戻る
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
