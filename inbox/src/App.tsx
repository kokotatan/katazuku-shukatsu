import { Base, Cluster, Stack, StatusLabel, Text } from 'smarthr-ui'
import { formatDate } from '@katazuku/data'
import { AppHeading, AppShell, DataState, Tile } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * メールと更新。メール抽出の結果をDBから読むだけの画面。
 * 人がここで状態を書き換えることはない(書き手はエージェント)。
 * 本文は保存していないので、出るのは要約とカテゴリだけ。
 */
export default function App() {
  const { data, error, loading, reload } = useKatazukuData()
  const mails = data?.mailItems ?? []
  const eventFeed = data?.enrichedEvents ?? []
  const needsAction = mails.filter((m) => Boolean(m.needsAction))

  return (
    <AppShell current="inbox">
      <AppHeading
        caption="INBOX"
        title="メールと更新"
        description="メール抽出結果をDBから読む画面です。人がここで状態を書き換えることはありません。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          <div className="ktz-tiles">
            <Tile label="DBメール" value={mails.length} />
            <Tile label="要対応" value={needsAction.length} tone={needsAction.length > 0 ? 'danger' : undefined} />
            <Tile label="更新イベント" value={eventFeed.length} />
            <Tile label="最終更新" value={formatDate(data.generatedAt)} />
          </div>

          <Stack gap={0.75} as="section" aria-label="メール一覧">
            {mails.map((mail) => (
              <Base key={mail.id} padding={1.25}>
                <Stack gap={0.5}>
                  <Cluster align="flex-start" justify="space-between" gap={0.5}>
                    <Stack gap={0.25}>
                      <Cluster align="center" gap={0.5}>
                        {Boolean(mail.needsAction) && <StatusLabel type="error" bold>要対応</StatusLabel>}
                        <StatusLabel type="grey">{mail.category}</StatusLabel>
                        {mail.company && <Text size="S" weight="bold" color="TEXT_LINK">{mail.company}</Text>}
                      </Cluster>
                      <Text weight="bold">{mail.subject}</Text>
                      {/* 本文はDBに持たない。要約(無ければ差出人)だけを見せる */}
                      <Text size="S" color="TEXT_GREY">{mail.summary || mail.sender}</Text>
                    </Stack>
                    <Text size="S" color="TEXT_GREY">{formatDate(mail.receivedAt)}</Text>
                  </Cluster>
                  {mail.deadline && (
                    <Text size="S" weight="bold" color="DANGER">期限: {formatDate(mail.deadline, false)}</Text>
                  )}
                </Stack>
              </Base>
            ))}

            {mails.length === 0 && (
              <>
                <Base padding={1.25}>
                  <Stack gap={0.25}>
                    <Text weight="bold">正規化メールはまだありません</Text>
                    <Text size="S" color="TEXT_GREY">
                      メール取り込みを動かすとここに溜まります。それまでは直近のDB更新イベントを表示します。
                    </Text>
                  </Stack>
                </Base>
                {eventFeed.slice(0, 30).map((event, i) => (
                  <Base key={String(event.id ?? i)} padding={1}>
                    <Cluster align="flex-start" justify="space-between" gap={0.75}>
                      <Stack gap={0.25}>
                        <Text size="S" weight="bold" color="TEXT_LINK">{String(event.company ?? '')}</Text>
                        <Text weight="bold">{String(event.summary ?? '')}</Text>
                        <Text size="S" color="TEXT_GREY">{String(event.kind ?? '')}</Text>
                      </Stack>
                      <Text size="S" color="TEXT_GREY">{formatDate(String(event.at ?? ''))}</Text>
                    </Cluster>
                  </Base>
                ))}
              </>
            )}
          </Stack>
        </>
      )}
    </AppShell>
  )
}
