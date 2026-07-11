import { useState } from 'react'
import { AnchorButton, Button, ControlledFormDialog, Input, Select, Textarea } from 'smarthr-ui'
import { STAGES, type Company, type Stage } from '../types'

interface Props {
  /** 編集対象。新規作成時は stage だけ入った下書き */
  initial: Partial<Company> & { stage: Stage }
  onSave: (data: Omit<Company, 'id' | 'updatedAt'>) => void
  onDelete?: () => void
  onClose: () => void
}

const PRIORITIES = ['第１志望群', '第２志望群', '第３志望群', 'それ以下']

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

  // ラベル(見出し)は Tailwind のまま、入力コントロールだけ smarthr-ui に載せ替える
  const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-slate-500'

  const submit = () => {
    onSave({
      name: name.trim(),
      role: role.trim(),
      stage,
      nextAction: nextAction.trim(),
      nextDate: nextDate || null,
      memo: memo.trim(),
      industry: industry.trim() || undefined,
      priority: priority || undefined,
      mypageUrl: mypageUrl.trim() || undefined,
    })
  }

  return (
    <ControlledFormDialog
      isOpen
      heading={initial.name ? '編集' : '企業を追加'}
      actionButton={{ text: '保存', theme: 'primary', disabled: !name.trim() }}
      closeButton={{ text: 'キャンセル' }}
      onSubmit={(_e, helpers) => {
        submit()
        helpers.close()
      }}
      onClickClose={onClose}
      onClickOverlay={onClose}
      onPressEscape={onClose}
      subActionArea={
        <div className="flex items-center gap-2">
          {initial.name && (
            <AnchorButton
              size="S"
              variant="secondary"
              href={`/prep/?company=${encodeURIComponent(initial.name)}`}
            >
              対策ノート
            </AnchorButton>
          )}
          {onDelete && (
            <Button
              size="S"
              variant="danger"
              onClick={() => {
                if (window.confirm(`「${initial.name}」を削除しますか?`)) onDelete()
              }}
            >
              削除
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className={labelCls}>
          企業名 *
          <Input
            width="100%"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="株式会社○○"
          />
        </label>
        <label className={labelCls}>
          職種・コース
          <Input
            width="100%"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="夏インターン / 総合職 など"
          />
        </label>
        <label className={labelCls}>
          ステージ
          <Select
            width="100%"
            value={stage}
            options={STAGES.map((s) => ({ value: s.key, label: s.label }))}
            onChangeValue={(v) => setStage(v as Stage)}
          />
        </label>
        <div className="flex gap-3">
          <label className={`flex-1 ${labelCls}`}>
            業界
            <Input
              width="100%"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="IT・通信 など"
            />
          </label>
          <label className={`flex-1 ${labelCls}`}>
            志望度
            <Select
              width="100%"
              value={priority}
              hasBlank
              blankLabel="未設定"
              options={PRIORITIES.map((p) => ({ value: p, label: p }))}
              onChangeValue={(v) => setPriority(v)}
            />
          </label>
        </div>
        <label className={labelCls}>
          マイページURL
          <span className="flex items-center gap-2">
            <Input
              width="100%"
              value={mypageUrl}
              onChange={(e) => setMypageUrl(e.target.value)}
              placeholder="https://mypage.example.com"
            />
            {mypageUrl.trim().startsWith('http') && (
              <AnchorButton
                size="S"
                variant="secondary"
                href={mypageUrl.trim()}
                target="_blank"
                rel="noreferrer"
              >
                開く
              </AnchorButton>
            )}
          </span>
        </label>
        <label className={labelCls}>
          次にやること
          <Input
            width="100%"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="ESを提出 / 日程を回答 など"
          />
        </label>
        <label className={labelCls}>
          期限・予定日
          <Input
            width="100%"
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
          />
        </label>
        <label className={labelCls}>
          メモ
          <Textarea
            width="100%"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="選考の経緯、対策メモなど"
          />
        </label>
      </div>
    </ControlledFormDialog>
  )
}
