import { ControlledActionDialog, StatusLabel } from 'smarthr-ui'
import type { Person } from '../types'
import { metMonth, personCategory } from '../lib/people'
import { Face } from './PeopleView'

/** 詳細の1項目(値が空なら描画しない) */
function Field({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm text-slate-800">{value}</dd>
    </div>
  )
}

/**
 * 顔セルをタップしたときの詳細ポップアップ(読む専用)。
 * 「編集」ボタンで PersonDialog(登録/編集モーダル)へ遷移する。
 */
export function PersonDetail({
  person,
  onEdit,
  onClose,
}: {
  person: Person
  /** 「編集」を押したとき(編集モーダルを開く) */
  onEdit: () => void
  onClose: () => void
}) {
  const category = personCategory(person)
  const month = metMonth(person)

  return (
    <ControlledActionDialog
      isOpen
      heading={person.name || '(名前未設定)'}
      actionButton={{ text: '編集', theme: 'primary' }}
      closeButton={{ text: '閉じる' }}
      onClickAction={(_e, helpers) => {
        helpers.close()
        onEdit()
      }}
      onClickClose={onClose}
      onClickOverlay={onClose}
      onPressEscape={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <Face person={person} size={72} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-px text-xs font-medium text-slate-600">
                {category}
              </span>
              {person.followUp && <StatusLabel type="warning">要フォロー</StatusLabel>}
            </div>
            {person.company && (
              <p className="break-words text-sm font-semibold text-slate-800">{person.company}</p>
            )}
            {person.role && <p className="break-words text-xs text-slate-500">{person.role}</p>}
          </div>
        </div>

        <dl className="flex flex-col gap-3">
          <Field label="出会った場面" value={person.metAt} />
          {month && <Field label="出会った時期" value={month} />}
          <Field label="どこでどう会ったか" value={person.howMet} />
          <Field label="話したこと・人柄・刺さった言葉" value={person.notes} />
        </dl>
      </div>
    </ControlledActionDialog>
  )
}
