import { AnchorButton, Base, Cluster, Heading, InformationPanel, Stack, StatusLabel, Text } from 'smarthr-ui'
import { daysLeft, formatDate, isClosed, parseDate, type Appointment, type Selection } from '@katazuku/data'
import { AppHeading, AppShell, DataState } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * 今日やること — 朝いちばんに開くページ。
 * 生きた予定と締切だけを、期限の近い順に並べる。
 */

const WEEKDAYS = '日月火水木金土'

function fmtAt(a: Appointment): string {
  const d = parseDate(a.at)
  if (!d) return a.at
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
  const hasTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(a.at)
  return hasTime ? `${base} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : base
}

function dueLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

function TrackSection({ title, rows, urgent }: {
  title: string
  rows: { s: Selection; due: Date | null }[]
  urgent?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <Stack gap={0.5}>
      <Cluster align="baseline" gap={0.5}>
        <Heading type="subBlockTitle">{title}</Heading>
        <Text size="S" color="TEXT_GREY">{rows.length}</Text>
      </Cluster>
      {rows.map(({ s, due }) => (
        <Base key={s.id} padding={0.75}>
          <Cluster align="center" gap={0.75}>
            {due ? (
              <StatusLabel type={urgent ? 'error' : 'grey'} bold={urgent}>
                {dueLabel(due)}{daysLeft(due) < 0 ? ` ${-daysLeft(due)}日超過` : ''}
              </StatusLabel>
            ) : (
              <StatusLabel type="grey">待ち</StatusLabel>
            )}
            <Text weight="bold">{s.company}</Text>
            {s.position && <Text size="S" color="TEXT_GREY">({s.position})</Text>}
            <Text size="S" color="TEXT_GREY">{s.nextAction || s.status}</Text>
          </Cluster>
        </Base>
      ))}
    </Stack>
  )
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()

  const active = (data?.selections ?? []).filter((s) => !isClosed(s))
  const appts = (data?.appointments ?? [])
    .filter((a) => (a.status || '予定') === '予定')
    .map((a) => ({ a, at: parseDate(a.at) }))
    .filter((x) => x.at !== null)
    .sort((x, y) => x.at!.getTime() - y.at!.getTime())
  const todayAppts = appts.filter((x) => daysLeft(x.at!) === 0)
  const weekAppts = appts.filter((x) => daysLeft(x.at!) > 0 && daysLeft(x.at!) <= 7)

  const dated = active
    .map((s) => ({ s, due: parseDate(s.nextDate) }))
    .filter((x) => x.due !== null && !x.s.submitted)
    .sort((x, y) => x.due!.getTime() - y.due!.getTime())
  const overdue = dated.filter((x) => daysLeft(x.due!) < 0)
  const soon = dated.filter((x) => daysLeft(x.due!) >= 0 && daysLeft(x.due!) <= 2)
  const week = dated.filter((x) => daysLeft(x.due!) > 2 && daysLeft(x.due!) <= 7)
  const waiting = active
    .filter((s) => !parseDate(s.nextDate) && /結果待ち|要確認|案内待ち|確定待ち|返信待ち/.test(s.status + s.nextAction))
    .map((s) => ({ s, due: null }))

  const quiet = overdue.length + soon.length + todayAppts.length === 0

  return (
    <AppShell current="insight">
      <AppHeading
        caption="INSIGHT"
        title="今日やること"
        description="朝いちばんに開くページ。DBの生きた予定と締切だけ。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          {(todayAppts.length > 0 || weekAppts.length > 0) && (
            <Stack gap={0.5}>
              <Cluster align="baseline" gap={0.5}>
                <Heading type="subBlockTitle">予定</Heading>
                <Text size="S" color="TEXT_GREY">面接・締切・説明会</Text>
              </Cluster>
              {[...todayAppts, ...weekAppts].map(({ a, at }) => (
                <Base key={a.id} padding={0.75}>
                  <Cluster align="center" gap={0.75}>
                    <StatusLabel type={daysLeft(at!) <= 0 ? 'error' : 'grey'} bold={daysLeft(at!) <= 0}>
                      {fmtAt(a)}
                    </StatusLabel>
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
          )}

          <TrackSection title="期限切れ(至急・要判断)" rows={overdue} urgent />
          <TrackSection title="今日〜あさって" rows={soon} urgent />
          <TrackSection title="今週" rows={week} />
          <TrackSection title="待ち(結果・案内)" rows={waiting} />

          {quiet && (
            <InformationPanel heading="直近の締切・予定はありません" toggleable={false}>
              <Text>自動運転が監視中です。新しい案内が来れば、ここに出ます。</Text>
            </InformationPanel>
          )}

          {data.pending.length > 0 && (
            <InformationPanel type="warning" heading={`名寄せの確認待ち ${data.pending.length}件`} toggleable={false}>
              <Stack gap={0.25}>
                {data.pending.map((p) => (
                  <Text key={`${p.name}-${p.createdAt}`} size="S"><b>{p.name}</b> — {p.context}</Text>
                ))}
              </Stack>
            </InformationPanel>
          )}

          {data.activities.length > 0 && (
            <Stack gap={0.5}>
              <Heading type="subBlockTitle">自動運転の直近の動き</Heading>
              {data.activities.slice(0, 5).map((a, i) => (
                <Text key={`${String(a.at)}-${i}`} size="S" color="TEXT_GREY">
                  {formatDate(String(a.at ?? ''))} {String(a.what ?? '')}
                  {a.why ? ` — ${String(a.why)}` : ''}
                </Text>
              ))}
            </Stack>
          )}
        </>
      )}
    </AppShell>
  )
}
