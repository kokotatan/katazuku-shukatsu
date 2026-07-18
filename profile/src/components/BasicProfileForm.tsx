import { useRef, type ReactNode } from 'react'
import { Button, FaUserIcon, Input, Select, Textarea } from 'smarthr-ui'
import type { BasicProfile } from '../types'
import { readFileAsDataURL } from '../lib/image'

const GENDER_OPTIONS = ['男性', '女性', '回答しない', 'その他'].map((v) => ({ value: v, label: v }))
const DEGREE_OPTIONS = ['学士', '修士', '博士', 'その他'].map((v) => ({ value: v, label: v }))

/** セクション見出し + 中身 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 border-b border-slate-200 pb-1 text-sm font-bold text-slate-800">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/** ラベル付きフィールド。full=trueで2カラム幅いっぱい */
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-semibold text-slate-500 ${full ? 'sm:col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  )
}

export function BasicProfileForm({
  value,
  onChange,
}: {
  value: BasicProfile
  onChange: (patch: Partial<BasicProfile>) => void
}) {
  const photoInput = useRef<HTMLInputElement>(null)

  // 各フィールドの共通ハンドラ(即時保存はApp側のuseEffectが担う)
  const set = (patch: Partial<BasicProfile>) => onChange(patch)

  const pickPhoto = async (file: File) => {
    try {
      set({ photo: await readFileAsDataURL(file, 512) })
    } catch {
      // 読み込み失敗時は据え置き
    }
  }

  const text = (key: keyof BasicProfile, placeholder = '', type = 'text') => (
    <Input
      width="100%"
      type={type}
      value={value[key] as string}
      onChange={(e) => set({ [key]: e.target.value } as Partial<BasicProfile>)}
      placeholder={placeholder}
    />
  )

  const area = (key: keyof BasicProfile, placeholder = '', rows = 3) => (
    <Textarea
      width="100%"
      rows={rows}
      value={value[key] as string}
      onChange={(e) => set({ [key]: e.target.value } as Partial<BasicProfile>)}
      placeholder={placeholder}
    />
  )

  return (
    <div>
      <p className="mb-5 text-xs text-slate-500">
        エントリーフォームに毎回入力する基本情報(履歴書項目)を1件だけ保持します。入力は自動保存され、リロードしても残ります。
      </p>

      <Section title="氏名">
        <Field label="姓">{text('lastName', '奥山')}</Field>
        <Field label="名">{text('firstName', '彪太郎')}</Field>
        <Field label="姓(かな)">{text('lastKana', 'おくやま')}</Field>
        <Field label="名(かな)">{text('firstKana', 'ひょうたろう')}</Field>
        <Field label="姓(ローマ字)">{text('lastRoma', 'Okuyama')}</Field>
        <Field label="名(ローマ字)">{text('firstRoma', 'Hyotaro')}</Field>
      </Section>

      <Section title="属性・連絡先">
        <Field label="生年月日">{text('birthday', '', 'date')}</Field>
        <Field label="性別">
          <Select
            width="100%"
            hasBlank
            blankLabel="未選択"
            value={value.gender}
            options={GENDER_OPTIONS}
            onChangeValue={(v) => set({ gender: v })}
          />
        </Field>
        <Field label="MBTI">{text('mbti', '例: INTJ')}</Field>
        <Field label="電話番号">{text('phone', '090-1234-5678', 'tel')}</Field>
        <Field label="メールアドレス">{text('email', 'you@example.com', 'email')}</Field>
        <Field label="予備メールアドレス" full>
          {text('emailSub', '大学アドレスなど', 'email')}
        </Field>
      </Section>

      <Section title="住所">
        <Field label="郵便番号">{text('postalCode', '123-4567')}</Field>
        <Field label="現住所" full>
          {area('address', '都道府県から番地・建物名まで', 2)}
        </Field>
        <Field label="現住所(ふりがな)" full>
          {area('addressKana', '', 2)}
        </Field>
        <Field label="帰省先・実家住所" full>
          {area('homeAddress', '現住所と異なる場合', 2)}
        </Field>
      </Section>

      <Section title="緊急連絡先">
        <Field label="氏名">{text('emergencyName', '例: 奥山○○')}</Field>
        <Field label="続柄">{text('emergencyRelation', '例: 父')}</Field>
        <Field label="電話番号">{text('emergencyPhone', '090-1234-5678', 'tel')}</Field>
        <Field label="郵便番号">{text('emergencyPostal', '123-4567')}</Field>
        <Field label="住所" full>
          {area('emergencyAddress', '現住所と異なる場合', 2)}
        </Field>
      </Section>

      <Section title="証明写真">
        <div className="sm:col-span-2 flex items-center gap-4">
          <div className="flex h-28 w-[5.6rem] shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-50">
            {value.photo ? (
              <img src={value.photo} alt="証明写真" className="h-full w-full object-cover" />
            ) : (
              <FaUserIcon className="text-slate-300" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="S" variant="secondary" onClick={() => photoInput.current?.click()}>
              写真を選ぶ
            </Button>
            {value.photo && (
              <Button size="S" variant="text" onClick={() => set({ photo: '' })}>
                削除
              </Button>
            )}
            <span className="text-xs font-normal text-slate-400">長辺512pxのJPEGに縮小して保存します</span>
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pickPhoto(f)
              e.target.value = ''
            }}
          />
        </div>
      </Section>

      <Section title="大学院(最終学歴)">
        <Field label="大学名" full>
          {text('university', '○○大学大学院')}
        </Field>
        <Field label="研究科・学部">{text('faculty', '○○研究科')}</Field>
        <Field label="専攻・学科">{text('department', '○○専攻')}</Field>
        <Field label="研究室・ゼミ">{text('lab', '')}</Field>
        <Field label="学位">
          <Select
            width="100%"
            hasBlank
            blankLabel="未選択"
            value={value.degree}
            options={DEGREE_OPTIONS}
            onChangeValue={(v) => set({ degree: v })}
          />
        </Field>
        <Field label="GPA">{text('gpa', '例: 3.4 / 4.0')}</Field>
        <Field label="入学年月">{text('enrollYm', '', 'month')}</Field>
        <Field label="卒業・修了予定年月">{text('gradYm', '', 'month')}</Field>
      </Section>

      <Section title="学部">
        <Field label="大学名" full>
          {text('undergradSchool', '○○大学')}
        </Field>
        <Field label="学部">{text('undergradFaculty', '○○学部')}</Field>
        <Field label="学科">{text('undergradDepartment', '○○学科')}</Field>
        <Field label="研究室・ゼミ">{text('undergradLab', '')}</Field>
        <Field label="GPA">{text('undergradGpa', '例: 3.4 / 4.0')}</Field>
        <Field label="入学年月">{text('undergradEnrollYm', '', 'month')}</Field>
        <Field label="卒業年月">{text('undergradGradYm', '', 'month')}</Field>
        <Field label="出身高校" full>
          {text('highSchool', '○○高等学校')}
        </Field>
      </Section>

      <Section title="資格・語学・スキル">
        <Field label="資格・免許" full>
          {area('certifications', '例: 普通自動車第一種運転免許(2024-06取得)')}
        </Field>
        <Field label="語学" full>
          {area('languages', '例: TOEIC 850(2025-04)')}
        </Field>
        <Field label="スキル" full>
          {area('skills', '例: TypeScript / React / Python')}
        </Field>
      </Section>

      <Section title="リンク">
        <Field label="GitHub">{text('github', 'https://github.com/...', 'url')}</Field>
        <Field label="ポートフォリオ">{text('portfolio', 'https://...', 'url')}</Field>
        <Field label="その他URL" full>
          {area('otherUrls', '1行に1URL', 2)}
        </Field>
      </Section>

      <Section title="就活基本">
        <Field label="志望業界">{text('desiredIndustry', '')}</Field>
        <Field label="志望職種">{text('desiredRole', '')}</Field>
        <Field label="キャリア軸・自己PRの軸" full>
          {area('careerAxis', '就活の軸・大切にしている価値観など')}
        </Field>
        <Field label="長所" full>
          {area('strengths', '')}
        </Field>
        <Field label="短所" full>
          {area('weaknesses', '')}
        </Field>
        <Field label="趣味" full>
          {area('hobbies', '')}
        </Field>
        <Field label="部活・サークル・課外活動" full>
          {area('clubs', '')}
        </Field>
        <Field label="知ったきっかけ" full>
          {text('foundVia', '例: 逆求人イベント / 大学の求人票 / 知人紹介')}
        </Field>
      </Section>

      {value.updatedAt && (
        <p className="mt-2 text-xs text-slate-400">
          最終更新: {new Date(value.updatedAt).toLocaleString('ja-JP')}
        </p>
      )}
    </div>
  )
}
