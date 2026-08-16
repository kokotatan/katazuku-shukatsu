import { Base, Cluster, DefinitionList, DefinitionListItem, Heading, Stack, StatusLabel, Text } from 'smarthr-ui'
import { textValue } from '@katazuku/data'
import { AppHeading, AppShell, DataState } from '@katazuku/ui'
import { useKatazukuData } from './lib/useKatazukuData'

/**
 * 個人マスタ。確定情報はDB正本から表示し、面接由来の情報は「候補」として分離する。
 *
 * 既定値は持たない(本体では氏名などが焼き込まれていた)。画面はDBにある物だけを映す。
 * 証明写真の実体はDBにもスナップショットにも入れないので、公開版では代替表示になる。
 */

const LABELS: Record<string, string> = {
  name: '氏名', nameKana: 'ふりがな', email: 'メール', phone: '電話番号',
  university: '大学', faculty: '学部', department: '学科', graduationYear: '卒業予定年',
  address: '住所', birthDate: '生年月日', gender: '性別',
  strengths: '強み', weaknesses: '弱み', careerAxis: '就活の軸',
  desiredRole: '希望職種', desiredIndustry: '希望業界', selfPr: '自己PR',
}

export default function App() {
  const { data, error, loading, reload } = useKatazukuData()
  const profile = data?.profile ?? {}
  const entries = Object.entries(profile).filter(([key, value]) => key !== 'photoKey' && textValue(value).trim())
  const suggestions = data?.profileSuggestions ?? []

  return (
    <AppShell current="profile">
      <AppHeading
        caption="PROFILE"
        title="個人マスタ"
        description="確定情報はDB正本から表示し、面接由来の情報は候補として分離します。"
        generatedAt={data?.generatedAt}
        onReload={reload}
        loading={loading}
      />

      {!data ? <DataState loading={loading} error={error} /> : (
        <div className="ktz-grid ktz-grid-aside">
          <Base padding={1.25}>
            <Stack gap={1}>
              <Cluster align="center" gap={1}>
                {/* 証明写真の実体は持たない(storage_key だけ)。公開版は配信口が無いので代替表示 */}
                <span aria-hidden className="ktz-face ktz-face-fallback">人</span>
                <Stack gap={0.25}>
                  <Heading type="subBlockTitle">基本情報</Heading>
                  <Text size="S" color="TEXT_GREY">{entries.length}項目をDBで管理中</Text>
                </Stack>
              </Cluster>

              {entries.length > 0 ? (
                <DefinitionList>
                  {entries.map(([key, value]) => (
                    <DefinitionListItem key={key} term={LABELS[key] || key}>{textValue(value)}</DefinitionListItem>
                  ))}
                </DefinitionList>
              ) : (
                <Text color="TEXT_GREY">
                  基本情報はまだありません。設定GUI(<code>examples/config-gui.html</code>)で作った内容を
                  <code> saveBasicProfile() </code>で保存すると、ここに出ます。
                </Text>
              )}
            </Stack>
          </Base>

          <Base padding={1.25}>
            <Stack gap={1}>
              <Cluster align="center" justify="space-between" gap={0.5}>
                <Heading type="subBlockTitle">面接からの候補</Heading>
                <StatusLabel type="blue">{suggestions.length}</StatusLabel>
              </Cluster>
              <Text size="S" color="TEXT_GREY">
                確定情報は自動で上書きしません。根拠つきの候補として貯めて、採否は本人が決めます。
              </Text>
              <Stack gap={0.75}>
                {suggestions.map((s, i) => (
                  <Base key={String(s.id ?? i)} padding={0.75}>
                    <Stack gap={0.25}>
                      <Text size="S" weight="bold" color="TEXT_LINK">{LABELS[String(s.field ?? '')] ?? String(s.field ?? '')}</Text>
                      <Text size="S">{String(s.value ?? '')}</Text>
                      <Text size="S" color="TEXT_GREY">
                        確度 {Math.round(Number(s.confidence ?? 0) * 100)}%
                      </Text>
                    </Stack>
                  </Base>
                ))}
                {suggestions.length === 0 && <Text color="TEXT_GREY">候補はまだありません。</Text>}
              </Stack>
            </Stack>
          </Base>
        </div>
      )}
    </AppShell>
  )
}
