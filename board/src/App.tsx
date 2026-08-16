import { useState } from 'react'
import {
  AnchorButton, Base, Button, Cluster, Heading, InformationPanel, LineClamp,
  Section, SegmentedControl, Stack, StatusLabel, Text,
} from 'smarthr-ui'
import {
  daysLeft, isClosed, parseDate,
  type Appointment, type KatazukuData, type Selection,
} from '@katazuku/data'
import { AppHeading, AppShell, DataState } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * katazuku ボード。正本DBのスナップショットを読むだけの「見る窓」。
 * 書き込みは一切しない(状態を変えるのはエージェントと本人だけ)。
 */

type Tab = 'today' | 'tracks' | 'companies' | 'log'

const WEEKDAYS = '日月火水木金土'

function fmtAt(a: Appointment): string {
  const d = parseDate(a.at)
  if (!d) return a.at
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  const hasTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(a.at)
  return hasTime ? `${base} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : base
}

/** outcome(コアの機械判定)を StatusLabel の型へ対応づける */
function OutcomeLabel({ s }: { s: Selection }) {
  if (s.outcome === '内定') return <StatusLabel type="green" bold>内定</StatusLabel>
  if (s.outcome === '合格') return <StatusLabel type="green">合格</StatusLabel>
  if (s.outcome === '不合格') return <StatusLabel type="grey">不合格</StatusLabel>
  if (s.outcome === '辞退') return <StatusLabel type="grey">辞退</StatusLabel>
  if (/要確認|結果待ち/.test(s.status)) return <StatusLabel type="warning">待ち</StatusLabel>
  return <StatusLabel type="blue">進行中</StatusLabel>
}

function DeadlineBadge({ s }: { s: Selection }) {
  const due = parseDate(s.nextDate)
  if (!due) return null
  const d = daysLeft(due)
  const label = d < 0 ? `${-d}日超過` : d === 0 ? '今日' : `残り${d}日`
  return <StatusLabel type={d <= 2 ? 'error' : 'grey'} bold={d < 0}>{label}</StatusLabel>
}

function TodayTab({ data }: { data: KatazukuData }) {
  const active = data.selections.filter((s) => !isClosed(s))
  const upcoming = data.appointments
    .filter((a) => (a.status || '予定') === '予定')
    .map((a) => ({ a, at: parseDate(a.at) }))
    .filter((x) => x.at && daysLeft(x.at) >= 0 && daysLeft(x.at) <= 14)
    .sort((x, y) => x.at!.getTime() - y.at!.getTime())
  const withDeadline = active
    .map((s) => ({ s, due: parseDate(s.nextDate) }))
    .filter((x) => x.due && !x.s.submitted)
    .sort((x, y) => x.due!.getTime() - y.due!.getTime())
  const waiting = active.filter((s) => /結果待ち|要確認|案内待ち|確定待ち/.test(s.status + s.nextAction))

  return (
    <Stack gap={1.5}>
      <Section>
        <Stack gap={0.5}>
          <Heading type="subBlockTitle">予定(面接・締切) — 14日以内</Heading>
          {upcoming.length === 0 && <Text color="TEXT_GREY">14日以内の予定はありません。</Text>}
          {upcoming.map(({ a, at }) => (
            <Base key={a.id} padding={0.75}>
              <Cluster align="center" gap={0.75}>
                <StatusLabel type={daysLeft(at!) <= 1 ? 'error' : 'grey'}>{fmtAt(a)}</StatusLabel>
                <Text weight="bold">{a.company}</Text>
                <Text size="S" color="TEXT_GREY">
                  {a.title}
                  {a.person && ` / ${a.person}`}
                  {a.location && ` @${a.location}`}
                </Text>
                {a.url && (
                  <AnchorButton size="S" variant="primary" href={a.url} target="_blank" rel="noreferrer">
                    開く
                  </AnchorButton>
                )}
              </Cluster>
            </Base>
          ))}
        </Stack>
      </Section>

      <Section>
        <Stack gap={0.5}>
          <Heading type="subBlockTitle">締切(未提出のトラック)</Heading>
          {withDeadline.length === 0 && <Text color="TEXT_GREY">期限つきの未提出はありません。</Text>}
          {withDeadline.map(({ s }) => (
            <Base key={s.id} padding={0.75}>
              <Stack gap={0.25}>
                <Cluster align="center" gap={0.5}>
                  <Text weight="bold">{s.company}</Text>
                  {s.position && <Text size="S" color="TEXT_GREY">({s.position})</Text>}
                  <DeadlineBadge s={s} />
                </Cluster>
                <Text size="S" color="TEXT_GREY">{s.nextAction || s.status}</Text>
              </Stack>
            </Base>
          ))}
        </Stack>
      </Section>

      <Section>
        <Stack gap={0.5}>
          <Heading type="subBlockTitle">待ち(結果・案内)</Heading>
          {waiting.length === 0 && <Text color="TEXT_GREY">待ちはありません。</Text>}
          {waiting.map((s) => (
            <Text key={s.id} size="S">
              <b>{s.company}</b>
              {s.position && `(${s.position})`} — {s.status}
            </Text>
          ))}
        </Stack>
      </Section>

      {data.pending.length > 0 && (
        <InformationPanel heading="名寄せの確認待ち" toggleable={false}>
          <Stack gap={0.5}>
            <Text size="S">
              エージェントが自動で判断せず、本人の確認へ回した企業名です。同じ会社なら別名として学習させ、
              別会社ならそのままにします。
            </Text>
            {data.pending.map((p) => (
              <Text key={`${p.name}-${p.createdAt}`} size="S">
                <b>{p.name}</b> — {p.context}
              </Text>
            ))}
          </Stack>
        </InformationPanel>
      )}
    </Stack>
  )
}

function TracksTab({ data }: { data: KatazukuData }) {
  return (
    <Stack gap={0.5}>
      {data.selections.length === 0 && <Text color="TEXT_GREY">選考はまだありません。</Text>}
      {data.selections.map((s) => (
        <Base key={s.id} padding={0.75}>
          <Stack gap={0.25}>
            <Cluster align="center" gap={0.5}>
              <OutcomeLabel s={s} />
              <Text weight="bold" color={isClosed(s) ? 'TEXT_GREY' : 'TEXT_BLACK'}>{s.company}</Text>
              <Text size="S" color="TEXT_GREY">
                {s.season}{s.position && `・${s.position}`}
              </Text>
              <DeadlineBadge s={s} />
            </Cluster>
            <Text size="S">{s.status}</Text>
            {s.steps.length > 0 && <Text size="S" color="TEXT_GREY">{s.steps.join(' → ')}</Text>}
            {s.nextAction && <Text size="S" color="TEXT_LINK">次: {s.nextAction}</Text>}
          </Stack>
        </Base>
      ))}
    </Stack>
  )
}

function CompaniesTab({ data }: { data: KatazukuData }) {
  const [open, setOpen] = useState<string | null>(null)
  const companies = [...new Set(data.selections.map((s) => s.company))]
    .map((name) => ({
      name,
      tracks: data.selections.filter((s) => s.company === name),
      master: data.companies.find((c) => c.shortName === name || c.name === name),
      dossier: data.dossiers.find((d) => d.company === name),
    }))
    .sort((a, b) => Number(a.tracks.every(isClosed)) - Number(b.tracks.every(isClosed)))

  return (
    <Stack gap={0.5}>
      {companies.length === 0 && <Text color="TEXT_GREY">企業はまだありません。</Text>}
      {companies.map((c) => (
        <Base key={c.name} padding={0.75}>
          <Stack gap={0.5}>
            <Cluster align="center" justify="space-between" gap={0.5}>
              <Cluster align="center" gap={0.5}>
                <Text weight="bold">{c.name}</Text>
                <Text size="S" color="TEXT_GREY">
                  {c.master?.industry}
                  {c.tracks.length > 1 ? ` / ${c.tracks.length}トラック` : ''}
                </Text>
              </Cluster>
              <Button size="S" variant="text" onClick={() => setOpen(open === c.name ? null : c.name)}>
                {open === c.name ? '閉じる' : '詳細'}
              </Button>
            </Cluster>

            {open === c.name && (
              <Stack gap={0.25}>
                {c.master?.name && c.master.name !== c.name && (
                  <Text size="S" color="TEXT_GREY">正式名称: {c.master.name}</Text>
                )}
                {c.tracks.map((t) => (
                  <Text key={t.id} size="S">
                    <b>{t.season}{t.position && `・${t.position}`}</b>: {t.status}
                    {t.steps.length > 0 && ` (${t.steps.join('→')})`}
                  </Text>
                ))}
                {c.dossier?.summary && (
                  <LineClamp maxLines={4}>
                    <Text size="S" color="TEXT_GREY">企業研究: {c.dossier.summary}</Text>
                  </LineClamp>
                )}
                {c.master?.mypageUrl && (
                  <Cluster>
                    <AnchorButton size="S" variant="secondary" href={c.master.mypageUrl} target="_blank" rel="noreferrer">
                      マイページを開く
                    </AnchorButton>
                  </Cluster>
                )}
                {c.master?.memo && <Text size="S" color="TEXT_GREY">{c.master.memo}</Text>}
              </Stack>
            )}
          </Stack>
        </Base>
      ))}
    </Stack>
  )
}

function LogTab({ data }: { data: KatazukuData }) {
  return (
    <Stack gap={0.5}>
      {data.activities.length === 0 && <Text color="TEXT_GREY">活動ログはまだありません。</Text>}
      {data.activities.map((a, i) => (
        <Base key={`${String(a.at)}-${i}`} padding={0.75}>
          <Stack gap={0.25}>
            <Cluster align="baseline" gap={0.5}>
              <Text size="S" weight="bold">{String(a.what ?? '')}</Text>
              <Text size="S" color="TEXT_GREY">{String(a.at ?? '')} / {String(a.how ?? '')}</Text>
            </Cluster>
            {a.why && (
              <LineClamp maxLines={3}>
                <Text size="S" color="TEXT_GREY">なぜ: {String(a.why)}</Text>
              </LineClamp>
            )}
          </Stack>
        </Base>
      ))}
    </Stack>
  )
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()
  const [tab, setTab] = useState<Tab>('today')

  const active = (data?.selections ?? []).filter((s) => !isClosed(s))
  const options = [
    { value: 'today', content: 'きょう' },
    { value: 'tracks', content: `選考 ${active.length}` },
    { value: 'companies', content: '企業' },
    { value: 'log', content: 'ログ' },
  ]

  return (
    <AppShell current="board">
      <AppHeading
        caption="BOARD"
        title="ボード"
        description="正本DBの状態を見るための、読み取り専用の窓。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          {data.demo && (
            <InformationPanel type="warning" heading="デモデータを表示しています" toggleable={false}>
              <Text>
                架空の企業・予定・ログです。自分のデータを見るには、リポジトリのルートで
                <code> npm run snapshot </code>
                を実行してから「再読込」を押してください(書き出した snapshot.json はコミットされません)。
              </Text>
            </InformationPanel>
          )}

          <SegmentedControl
            options={options}
            value={tab}
            onClickOption={(v) => setTab(v as Tab)}
            aria-label="表示する一覧"
          />
          {tab === 'today' && <TodayTab data={data} />}
          {tab === 'tracks' && <TracksTab data={data} />}
          {tab === 'companies' && <CompaniesTab data={data} />}
          {tab === 'log' && <LogTab data={data} />}

          <Text size="S" color="TEXT_GREY">
            このボードは正本DBへ書き込みません。状態を変えるのはエージェントと本人だけです。
          </Text>
        </>
      )}
    </AppShell>
  )
}
