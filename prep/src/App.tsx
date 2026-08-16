import { useState } from 'react'
import { Base, Cluster, DefinitionList, DefinitionListItem, Heading, Select, Stack, Text, TextLink } from 'smarthr-ui'
import { formatDate, textValue } from '@katazuku/data'
import { AppHeading, AppShell, DataState } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/** 面接準備。予定・企業研究・過去面接を会社ごとに束ねる */
export default function App() {
  const { data, error, loading, reload } = useKatazukuData()
  const [selected, setSelected] = useState('')

  const upcoming = (data?.appointments ?? [])
    .filter((a) => a.status === '予定' && new Date(a.at).getTime() >= Date.now() - 60 * 60 * 1000)
    .sort((a, b) => a.at.localeCompare(b.at))

  const companies = Array.from(new Set([
    ...upcoming.map((a) => a.company),
    ...(data?.dossiers ?? []).map((d) => d.company),
  ])).filter(Boolean)

  const company = selected || upcoming[0]?.company || companies[0] || ''
  const dossier = data?.dossiers.find((d) => d.company === company)
  const interviews = (data?.interviews ?? []).filter((i) => i.company === company)

  return (
    <AppShell current="prep">
      <AppHeading
        caption="PREP"
        title="面接準備"
        description="予定・企業研究・過去面接を会社ごとに束ねます。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <>
          <div className="ktz-grid ktz-grid-cards" aria-label="直近予定">
            {upcoming.slice(0, 4).map((a) => (
              <Base key={a.id} padding={1}>
                <button type="button" className="ktz-plain-button" onClick={() => setSelected(a.company)}>
                  <Stack gap={0.5}>
                    <Cluster align="flex-start" justify="space-between" gap={0.75}>
                      <Stack gap={0.25}>
                        <Text size="S" weight="bold" color="TEXT_LINK">{a.company}</Text>
                        <Text weight="bold">{a.title}</Text>
                      </Stack>
                      <Text size="S" weight="bold">{formatDate(a.at)}</Text>
                    </Cluster>
                    <Text size="S" color="TEXT_GREY">
                      {[a.person, a.location].filter(Boolean).join(' / ') || a.kind}
                    </Text>
                  </Stack>
                </button>
              </Base>
            ))}
            {upcoming.length === 0 && (
              <Base padding={1.25}><Text color="TEXT_GREY">今後の予定はありません。</Text></Base>
            )}
          </div>

          <Base padding={1}>
            <Cluster align="center" gap={0.75}>
              <Text size="S" weight="bold" id="prep-company-label">準備する会社</Text>
              <Select
                aria-labelledby="prep-company-label"
                value={company}
                options={companies.map((name) => ({ value: name, label: name }))}
                onChangeValue={setSelected}
              />
            </Cluster>
          </Base>

          <div className="ktz-grid ktz-grid-aside">
            <Base padding={1.25}>
              <Stack gap={1}>
                <Cluster align="center" justify="space-between" gap={0.75}>
                  <Heading type="subBlockTitle">企業研究</Heading>
                  {dossier && <Text size="S" color="TEXT_GREY">{formatDate(dossier.researchedAt)}</Text>}
                </Cluster>

                {dossier ? (
                  <Stack gap={1}>
                    <Text>{dossier.summary}</Text>
                    <DefinitionList>
                      {Object.entries(dossier.facts).map(([key, value]) => (
                        <DefinitionListItem key={key} term={key}>{textValue(value)}</DefinitionListItem>
                      ))}
                    </DefinitionList>
                    <Stack gap={0.25}>
                      <Text size="S" weight="bold">根拠</Text>
                      {dossier.sources.map((source, i) => (
                        <Text key={source.url || i} size="S">
                          {source.url
                            ? <TextLink href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</TextLink>
                            : source.title}
                        </Text>
                      ))}
                      {dossier.sources.length === 0 && <Text size="S" color="TEXT_GREY">根拠は未登録です。</Text>}
                    </Stack>
                  </Stack>
                ) : (
                  <Text color="TEXT_GREY">
                    この会社の企業研究はまだありません。企業研究のパイプラインを流すとここへ入ります。
                  </Text>
                )}
              </Stack>
            </Base>

            <Base padding={1.25}>
              <Stack gap={1}>
                <Heading type="subBlockTitle">過去面接</Heading>
                {interviews.map((interview) => (
                  <Stack key={interview.id} gap={0.25}>
                    <Text size="S" color="TEXT_GREY">{formatDate(interview.occurredAt)}</Text>
                    <Text size="S" weight="bold">{interview.title}</Text>
                    <Text size="S" color="TEXT_GREY">{interview.summary}</Text>
                  </Stack>
                ))}
                {interviews.length === 0 && <Text color="TEXT_GREY">面接記録はまだありません。</Text>}
              </Stack>
            </Base>
          </div>
        </>
      )}
    </AppShell>
  )
}
