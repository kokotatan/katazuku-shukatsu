import { Base, Cluster, DefinitionList, DefinitionListItem, Stack, StatusLabel, Text } from 'smarthr-ui'
import { formatDate, type Selection } from '@katazuku/data'
import { AppHeading, AppShell, DataState, Tile } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/** 選考管理。DB正本の選考トラックを読み取り専用で表示する */

const TERMINAL = ['不合格', '辞退', '終了']

function OutcomeLabel({ outcome }: { outcome: string }) {
  if (outcome === '内定') return <StatusLabel type="green" bold>内定</StatusLabel>
  if (outcome === '合格') return <StatusLabel type="green">合格</StatusLabel>
  if (TERMINAL.includes(outcome)) return <StatusLabel type="grey">{outcome}</StatusLabel>
  return <StatusLabel type="blue">{outcome || '進行中'}</StatusLabel>
}

function TrackCard({ track }: { track: Selection }) {
  return (
    <Base padding={1.25}>
      <Stack gap={1}>
        <Cluster align="flex-start" justify="space-between" gap={0.75}>
          <Stack gap={0.25}>
            <Text size="S" weight="bold" color="TEXT_LINK">{track.priority || '通常'}</Text>
            <Text size="L" weight="bold">{track.company}</Text>
            <Text size="S" color="TEXT_GREY">
              {[track.season, track.position].filter(Boolean).join(' / ') || 'トラック未設定'}
            </Text>
          </Stack>
          <OutcomeLabel outcome={track.outcome} />
        </Cluster>
        <DefinitionList>
          <DefinitionListItem term="現在地">{track.status || '未設定'}</DefinitionListItem>
          <DefinitionListItem term="次にやること">{track.nextAction || '未設定'}</DefinitionListItem>
          <DefinitionListItem term="期限">{track.nextDate ? formatDate(track.nextDate, false) : '未設定'}</DefinitionListItem>
          <DefinitionListItem term="提出">{track.submitted ? '提出済み' : '未提出'}</DefinitionListItem>
        </DefinitionList>
      </Stack>
    </Base>
  )
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()

  // 終了したトラックは後ろへ沈め、同順位は会社名の五十音で並べる
  const tracks = [...(data?.selections ?? [])].sort((a, b) => {
    const terminal = (v: Selection) => TERMINAL.includes(v.outcome)
    return Number(terminal(a)) - Number(terminal(b)) || a.company.localeCompare(b.company, 'ja')
  })
  const active = tracks.filter((t) => !TERMINAL.includes(t.outcome))
  const positive = tracks.filter((t) => ['合格', '内定'].includes(t.outcome))

  return (
    <AppShell current="status">
      <AppHeading
        caption="STATUS"
        title="選考管理"
        description="DB正本の選考トラックを読み取り専用で表示します。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          <div className="ktz-tiles">
            <Tile label="全トラック" value={tracks.length} />
            <Tile label="進行中" value={active.length} />
            <Tile label="合格・内定" value={positive.length} />
            <Tile label="終了" value={tracks.length - active.length} />
          </div>

          <div className="ktz-grid ktz-grid-2" aria-label="選考トラック">
            {tracks.map((track) => <TrackCard key={track.id} track={track} />)}
          </div>

          {tracks.length === 0 && <Text color="TEXT_GREY">選考トラックはまだありません。</Text>}
        </>
      )}
    </AppShell>
  )
}
