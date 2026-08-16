import { Base, Cluster, Heading, Stack, Text } from 'smarthr-ui'
import { formatDate } from '@katazuku/data'
import { AppHeading, AppShell, DataState, Tile } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * 自動運転の効果。
 * 「削減できた推定時間」のような作り話は出さない。DBに実際に残った件数と結果だけを数える。
 */

const AUTOMATED = /daily-sync|calendar-sync|interview-digest|submit-agent/
const OUTCOMES = ['進行中', '合格', '内定', '不合格', '辞退']

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const width = total ? Math.max(2, Math.round((count / total) * 100)) : 0
  return (
    <Stack gap={0.25}>
      <Cluster align="baseline" justify="space-between">
        <Text size="S">{label}</Text>
        <Text size="S" weight="bold">{count}</Text>
      </Cluster>
      <div className="ktz-bar"><div className="ktz-bar-fill" style={{ width: `${width}%` }} /></div>
    </Stack>
  )
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()

  const selections = data?.selections ?? []
  const automated = (data?.enrichedEvents ?? []).filter((e) => AUTOMATED.test(String(e.source ?? '')))
  const active = selections.filter((s) => !['不合格', '辞退', '終了'].includes(s.outcome))
  const positive = selections.filter((s) => ['合格', '内定'].includes(s.outcome))
  const activities = data?.activities ?? []

  return (
    <AppShell current="impact">
      <AppHeading
        caption="IMPACT"
        title="自動運転の効果"
        description="推定時間ではなく、DBに残った処理件数と結果を表示します。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          <div className="ktz-tiles" aria-label="主要指標">
            <Tile label="管理中トラック" value={selections.length} />
            <Tile label="進行中" value={active.length} />
            <Tile label="合格・内定" value={positive.length} />
            <Tile label="自動処理イベント" value={automated.length} />
          </div>

          <div className="ktz-grid ktz-grid-2">
            <Base padding={1.25}>
              <Stack gap={1}>
                <Heading type="subBlockTitle">入力パイプライン</Heading>
                <div className="ktz-tiles">
                  <Tile label="メール・選考イベント" value={data.enrichedEvents.length} />
                  <Tile label="カレンダー予定" value={data.appointments.length} />
                  <Tile label="面接記録" value={data.interviews.length} />
                  <Tile label="提出記録" value={data.submissions.length} />
                  <Tile label="企業研究" value={data.dossiers.length} />
                  <Tile label="人物" value={data.people.length} />
                </div>
              </Stack>
            </Base>

            <Base padding={1.25}>
              <Stack gap={1}>
                <Heading type="subBlockTitle">結果内訳</Heading>
                <Stack gap={0.75}>
                  {OUTCOMES.map((outcome) => (
                    <Bar
                      key={outcome}
                      label={outcome}
                      count={selections.filter((s) => s.outcome === outcome).length}
                      total={selections.length}
                    />
                  ))}
                </Stack>
              </Stack>
            </Base>
          </div>

          <Base padding={1.25}>
            <Stack gap={1}>
              <Cluster align="center" justify="space-between" gap={0.75}>
                <Heading type="subBlockTitle">活動ログ</Heading>
                <Text size="S" color="TEXT_GREY">{activities.length}件</Text>
              </Cluster>
              <Stack gap={0.75}>
                {activities.slice(0, 30).map((a, i) => (
                  <Cluster key={String(a.at ?? i)} align="flex-start" gap={0.75}>
                    <Text size="S" color="TEXT_GREY">{formatDate(String(a.at ?? ''))}</Text>
                    <Stack gap={0.25}>
                      <Text size="S" weight="bold">{String(a.what ?? '自律処理')}</Text>
                      <Text size="S" color="TEXT_GREY">
                        {[a.why, a.how].filter(Boolean).map(String).join(' / ')}
                      </Text>
                    </Stack>
                  </Cluster>
                ))}
                {activities.length === 0 && <Text color="TEXT_GREY">活動ログはまだありません。</Text>}
              </Stack>
            </Stack>
          </Base>
        </>
      )}
    </AppShell>
  )
}
