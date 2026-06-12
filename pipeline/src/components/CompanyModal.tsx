import { useState } from 'react'
import { STAGES, type Company, type Stage } from '../types'

interface Props {
  /** 編集対象。新規作成時は stage だけ入った下書き */
  initial: Partial<Company> & { stage: Stage }
  onSave: (data: Omit<Company, 'id' | 'updatedAt'>) => void
  onDelete?: () => void
  onClose: () => void
}

export function CompanyModal({ initial, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(initial.name ?? '')
  const [role, setRole] = useState(initial.role ?? '')
  const [stage, setStage] = useState<Stage>(initial.stage)
  const [nextAction, setNextAction] = useState(initial.nextAction ?? '')
  const [nextDate, setNextDate] = useState(initial.nextDate ?? '')
  const [memo, setMemo] = useState(initial.memo ?? '')
  const [industry, setIndustry] = useState(initial.industry ?? '')
  const [priority, setPriority] = useState(initial.priority ?? '')
  const [mypageUrl, setMypageUrl] = useState(initial.mypageUrl ?? '')

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{initial.name ? '編集' : '企業を追加'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-500">
            企業名 *
            <input value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="株式会社○○" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            職種・コース
            <input value={role} onChange={(e) => setRole(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="夏インターン / 総合職 など" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            ステージ
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={`mt-1 ${inputCls}`}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <label className="flex-1 text-xs font-semibold text-slate-500">
              業界
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="IT・通信 など" />
            </label>
            <label className="flex-1 text-xs font-semibold text-slate-500">
              志望度
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={`mt-1 ${inputCls}`}>
                <option value="">未設定</option>
                <option value="第１志望群">第１志望群</option>
                <option value="第２志望群">第２志望群</option>
                <option value="第３志望群">第３志望群</option>
                <option value="それ以下">それ以下</option>
              </select>
            </label>
          </div>
          <label className="text-xs font-semibold text-slate-500">
            マイページURL
            <span className="flex items-center gap-2">
              <input value={mypageUrl} onChange={(e) => setMypageUrl(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="https://mypage.example.com" />
              {mypageUrl.trim().startsWith('http') && (
                <a
                  href={mypageUrl.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50"
                >
                  開く ↗
                </a>
              )}
            </span>
          </label>
          <label className="text-xs font-semibold text-slate-500">
            次にやること
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="ESを提出 / 日程を回答 など" />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            期限・予定日
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            メモ
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} className={`mt-1 ${inputCls}`} placeholder="選考の経緯、対策メモなど" />
          </label>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => onSave({ name: name.trim(), role: role.trim(), stage, nextAction: nextAction.trim(), nextDate: nextDate || null, memo: memo.trim(), industry: industry.trim() || undefined, priority: priority || undefined, mypageUrl: mypageUrl.trim() || undefined })}
            disabled={!name.trim()}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
          >
            保存
          </button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            キャンセル
          </button>
          {onDelete && (
            <button
              onClick={() => { if (window.confirm(`「${initial.name}」を削除しますか?`)) onDelete() }}
              className="ml-auto rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              削除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
