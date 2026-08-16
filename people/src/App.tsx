import { Base, Cluster, DefinitionList, DefinitionListItem, Stack, StatusLabel, Text } from 'smarthr-ui'
import { formatDate, photoUrl, type Person } from '@katazuku/data'
import { AppHeading, AppShell, DataState } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * 人。面接官・社員・OBOGを、出会った根拠と追記専用メモで管理する。
 *
 * 顔写真の実体はDBにもスナップショットにも入れず、storage_key だけを持つ。
 * 公開版は写真の配信口を持たない(`photoUrl` は null を返す)ので、頭文字で代替する。
 */

function Face({ person }: { person: Person }) {
  const src = person.photoKey ? photoUrl(person.photoKey) : null
  if (src) {
    return <img src={src} alt="" className="ktz-face" />
  }
  return <span aria-hidden className="ktz-face ktz-face-fallback">{person.name.trim().charAt(0) || '?'}</span>
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()
  const people = data?.people ?? []
  const notes = data?.personNotes ?? []

  return (
    <AppShell current="people">
      <AppHeading
        caption="PEOPLE"
        title="人"
        description="面接官・社員・OBOGを、出会った根拠と追記専用メモで管理します。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          <Base padding={1}>
            <Cluster align="baseline" gap={0.75}>
              <Text size="S" color="TEXT_GREY">登録人物</Text>
              <Text size="XL" weight="bold">{people.length}</Text>
            </Cluster>
          </Base>

          <div className="ktz-grid ktz-grid-cards" aria-label="人物一覧">
            {people.map((person) => {
              const personNotes = notes.filter((n) => n.personId === person.id)
              return (
                <Base key={person.id} padding={1.25}>
                  <Stack gap={1}>
                    <Cluster align="flex-start" gap={1}>
                      <Face person={person} />
                      <Stack gap={0.25}>
                        <Cluster gap={0.5}>
                          <StatusLabel type="grey">{person.category || '関係者'}</StatusLabel>
                          {person.followUp && <StatusLabel type="warning">要フォロー</StatusLabel>}
                        </Cluster>
                        <Text size="L" weight="bold">{person.name}</Text>
                        <Text size="S" color="TEXT_GREY">
                          {[person.company, person.role].filter(Boolean).join(' / ') || '所属未設定'}
                        </Text>
                      </Stack>
                    </Cluster>

                    <DefinitionList>
                      <DefinitionListItem term="出会い">{person.howMet || '未設定'}</DefinitionListItem>
                      <DefinitionListItem term="会った日">{person.metAt ? formatDate(person.metAt, false) : '未設定'}</DefinitionListItem>
                      <DefinitionListItem term="フォロー">{person.followUp || '未設定'}</DefinitionListItem>
                    </DefinitionList>

                    {personNotes.length > 0 && (
                      <Stack gap={0.25}>
                        {personNotes.slice(0, 3).map((note) => (
                          <Text key={note.id} size="S">{note.note}</Text>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Base>
              )
            })}
          </div>

          {people.length === 0 && (
            <Text color="TEXT_GREY">
              まだ登録がありません。面接や説明会の記録を取り込むと、エージェントがここへ人物を積みます。
            </Text>
          )}
        </>
      )}
    </AppShell>
  )
}
