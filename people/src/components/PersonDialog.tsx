import { useMemo, useRef, useState } from 'react'
import { Button, Checkbox, ControlledFormDialog, Input, Select, Textarea } from 'smarthr-ui'
import type { Person } from '../types'
import { CATEGORIES, DEFAULT_CATEGORY, personCategory } from '../lib/people'
import { readFileAsDataURL } from '../lib/image'
import { Face } from './PeopleView'

const PIPELINE_KEY = 'katazuku-pipeline/companies'

function pipelineNames(): string[] {
  try {
    const raw = localStorage.getItem(PIPELINE_KEY)
    if (raw !== null) {
      return (JSON.parse(raw) as { name?: string }[]).map((c) => c.name ?? '').filter(Boolean)
    }
  } catch {
    // なければ空
  }
  return []
}

export type PersonInput = Omit<Person, 'id' | 'updatedAt'>

/** 追加・編集を兼ねるモーダル。編集時は削除ボタンも内に置く */
export function PersonDialog({
  initial,
  people,
  onSave,
  onDelete,
  onClose,
}: {
  /** 編集対象。新規追加時は null */
  initial: Person | null
  /** 企業名候補の名寄せ元(登録済みの人) */
  people: Person[]
  onSave: (v: PersonInput) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [company, setCompany] = useState(initial?.company ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [category, setCategory] = useState(personCategory(initial ?? {}))
  const [metAt, setMetAt] = useState(initial?.metAt ?? '')
  const [howMet, setHowMet] = useState(initial?.howMet ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [facePhoto, setFacePhoto] = useState<string | undefined>(initial?.facePhoto)
  const [followUp, setFollowUp] = useState(initial?.followUp ?? false)
  const faceInput = useRef<HTMLInputElement>(null)

  const companyOptions = useMemo(() => {
    const set = new Set<string>(pipelineNames())
    for (const p of people) if (p.company) set.add(p.company)
    return [...set]
  }, [people])

  const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-slate-500'

  const pickFace = async (file: File) => {
    try {
      setFacePhoto(await readFileAsDataURL(file, 256))
    } catch {
      // 読み込み失敗時は据え置き
    }
  }

  const submit = () => {
    onSave({
      name: name.trim(),
      company: company.trim(),
      role: role.trim(),
      category: category || DEFAULT_CATEGORY,
      metAt: metAt.trim(),
      howMet: howMet.trim(),
      notes: notes.trim(),
      facePhoto,
      followUp,
    })
  }

  // プレビュー用の仮 Person(頭文字フォールバックのため name を渡す)
  const preview: Person = {
    id: '',
    updatedAt: '',
    name,
    company,
    role,
    category,
    metAt,
    howMet,
    notes,
    facePhoto,
    followUp,
  }

  return (
    <ControlledFormDialog
      isOpen
      heading={initial ? '人を編集' : '人を登録'}
      actionButton={{ text: '保存', theme: 'primary', disabled: !name.trim() }}
      closeButton={{ text: 'キャンセル' }}
      onSubmit={(_e, helpers) => {
        if (!name.trim()) return
        submit()
        helpers.close()
      }}
      onClickClose={onClose}
      onClickOverlay={onClose}
      onPressEscape={onClose}
      subActionArea={
        onDelete && (
          <Button
            size="S"
            variant="danger"
            onClick={() => {
              if (window.confirm(`「${initial?.name}」を削除しますか?`)) onDelete()
            }}
          >
            削除
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Face person={preview} size={56} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Button
                size="S"
                variant="secondary"
                type="button"
                onClick={() => faceInput.current?.click()}
              >
                顔写真を選ぶ
              </Button>
              {facePhoto && (
                <Button
                  size="S"
                  variant="text"
                  type="button"
                  onClick={() => setFacePhoto(undefined)}
                >
                  削除
                </Button>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              顔を覚えるための小さな写真(長辺256pxに縮小)
            </p>
          </div>
          <input
            ref={faceInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pickFace(f)
              e.target.value = ''
            }}
          />
        </div>

        <div className="flex gap-3">
          <label className={`flex-1 ${labelCls}`}>
            名前 *
            <Input
              width="100%"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
            />
          </label>
          <label className={`w-40 shrink-0 ${labelCls}`}>
            種別
            <Select
              width="100%"
              value={category}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              onChangeValue={(v) => setCategory(v)}
            />
          </label>
        </div>

        <div className="flex gap-3">
          <label className={`flex-1 ${labelCls}`}>
            企業
            <Input
              width="100%"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              list="people-company-options"
              placeholder="株式会社○○"
            />
          </label>
          <label className={`flex-1 ${labelCls}`}>
            部署・肩書き
            <Input
              width="100%"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="人事 / エンジニア など"
            />
          </label>
        </div>
        <datalist id="people-company-options">
          {companyOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <label className={labelCls}>
          出会った場面
          <Input
            width="100%"
            value={metAt}
            onChange={(e) => setMetAt(e.target.value)}
            placeholder="7/16 二次面接 など"
          />
        </label>

        <label className={labelCls}>
          どこでどう会ったか
          <Input
            width="100%"
            value={howMet}
            onChange={(e) => setHowMet(e.target.value)}
            placeholder="オンライン面接で / 説明会で声をかけた など"
          />
        </label>

        <label className={labelCls}>
          話したこと・人柄・刺さった言葉
          <Textarea
            width="100%"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="次に会うときに思い出したいこと"
          />
        </label>

        <div>
          <Checkbox checked={followUp} onChange={(e) => setFollowUp(e.target.checked)}>
            お礼・連絡が必要
          </Checkbox>
        </div>
      </div>
    </ControlledFormDialog>
  )
}
