import { useEffect, useMemo, useState } from 'react'
import {
  Base, Center, Cluster, EmptyTableBody, Heading, InformationPanel, Loader,
  Section, SegmentedControl, Stack, StatusLabel,
  Table, Td, Text, Th,
} from 'smarthr-ui'
import type { AppointmentCard, BoardSnapshot, MailCard, PendingCard, SelectionCard } from './types'

type TabId = 'selections' | 'appointments' | 'pending' | 'mail'

/** outcome(機械判定)を SmartHR の StatusLabel の型へ対応づける */
const OUTCOME_LABEL: Record<string, { type: 'grey' | 'blue' | 'green' | 'red' | 'warning'; bold?: boolean }> = {
  進行中: { type: 'blue' },
  合格: { type: 'green' },
  内定: { type: 'green', bold: true },
  不合格: { type: 'grey' },
  辞退: { type: 'grey' },
}

function OutcomeLabel({ outcome }: { outcome: string }) {
  const style = OUTCOME_LABEL[outcome] ?? { type: 'grey' as const }
  return <StatusLabel type={style.type} bold={style.bold}>{outcome}</StatusLabel>
}

const DATE = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
const TIME = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

function formatAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // 時刻が 00:00 のものは日付だけの予定(締切)とみなす
  const time = TIME.format(d)
  return time === '00:00' ? DATE.format(d) : `${DATE.format(d)} ${time}`
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'attention' }) {
  // 「0であってほしい」数(要対応・確認待ち)だけ、0でないときに注意色を添える
  const alert = tone === 'attention' && value > 0
  return (
    <Base className="board-tile" padding={1}>
      <Stack gap={0.25}>
        <Text size="S" color="TEXT_GREY">{label}</Text>
        <Cluster align="center" gap={0.5}>
          <Text size="XL" weight="bold">{value}</Text>
          {alert && <StatusLabel type="warning">要対応</StatusLabel>}
        </Cluster>
      </Stack>
    </Base>
  )
}

function SelectionsTable({ rows }: { rows: SelectionCard[] }) {
  return (
    <div className="board-table-wrap">
      <Table>
        <thead>
          <tr>
            <Th>企業</Th>
            <Th>状態</Th>
            <Th>選考</Th>
            <Th>ステータス</Th>
            <Th>次の行動</Th>
            <Th>期日</Th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <EmptyTableBody><Text>選考はまだありません。</Text></EmptyTableBody>
        ) : (
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <Td>{s.company}</Td>
                <Td><OutcomeLabel outcome={s.outcome} /></Td>
                <Td>{[s.season, s.position].filter(Boolean).join(' / ')}</Td>
                <Td>{s.status || '—'}</Td>
                <Td>{s.nextAction || '—'}</Td>
                <Td>{s.nextDate || '—'}</Td>
              </tr>
            ))}
          </tbody>
        )}
      </Table>
    </div>
  )
}

function AppointmentsTable({ rows }: { rows: AppointmentCard[] }) {
  return (
    <div className="board-table-wrap">
      <Table>
        <thead>
          <tr>
            <Th>日時</Th>
            <Th>企業</Th>
            <Th>種別</Th>
            <Th>内容</Th>
            <Th>場所 / 形式</Th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <EmptyTableBody><Text>予定はありません。</Text></EmptyTableBody>
        ) : (
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td>{formatAt(a.at)}</Td>
                <Td>{a.company}</Td>
                <Td><StatusLabel type={a.kind === '締切' ? 'warning' : 'blue'}>{a.kind}</StatusLabel></Td>
                <Td>{a.title}</Td>
                {/* 参加リンクそのものは「見る窓」に出さない。オンラインかどうかだけ分かればよい */}
                <Td>{a.location || (a.hasUrl ? 'オンライン' : '—')}</Td>
              </tr>
            ))}
          </tbody>
        )}
      </Table>
    </div>
  )
}

function PendingTable({ rows }: { rows: PendingCard[] }) {
  return (
    <Stack gap={1}>
      <InformationPanel heading="名寄せの確認待ち" toggleable={false}>
        <Text>
          エージェントが自動で判断せず、本人の確認へ回した企業名です。同じ会社なら別名として学習させ、
          別会社ならそのままにします。ここが空なら、DBの企業テーブルは意図どおりに保たれています。
        </Text>
      </InformationPanel>
      <div className="board-table-wrap">
        <Table>
          <thead>
            <tr>
              <Th>入力された名前</Th>
              <Th>理由</Th>
              <Th>積まれた日時</Th>
            </tr>
          </thead>
          {rows.length === 0 ? (
            <EmptyTableBody><Text>確認待ちはありません。</Text></EmptyTableBody>
          ) : (
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.name}-${p.createdAt}`}>
                  <Td>{p.name}</Td>
                  <Td>{p.context}</Td>
                  <Td>{formatAt(p.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          )}
        </Table>
      </div>
    </Stack>
  )
}

function MailTable({ rows }: { rows: MailCard[] }) {
  return (
    <div className="board-table-wrap">
      <Table>
        <thead>
          <tr>
            <Th>締切</Th>
            <Th>企業</Th>
            <Th>種別</Th>
            <Th>件名</Th>
            <Th>要約</Th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <EmptyTableBody><Text>要対応のメールはありません。</Text></EmptyTableBody>
        ) : (
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td>{m.deadline || '—'}</Td>
                <Td>{m.company ?? '—'}</Td>
                <Td>{m.category}</Td>
                <Td>{m.subject}</Td>
                {/* 本文はDBにも持たない。要約だけを見せる */}
                <Td>{m.summary || '—'}</Td>
              </tr>
            ))}
          </tbody>
        )}
      </Table>
    </div>
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('selections')

  useEffect(() => {
    // 実データの snapshot.json があればそれを、無ければ同梱のデモを読む
    const load = async () => {
      for (const path of ['./snapshot.json', './snapshot.demo.json']) {
        try {
          const res = await fetch(path)
          if (!res.ok) continue
          setSnapshot(await res.json() as BoardSnapshot)
          return
        } catch {
          // 次の候補へ
        }
      }
      setError('スナップショットを読み込めませんでした。`npm run board:demo` を実行してください。')
    }
    void load()
  }, [])

  const counts = useMemo(() => {
    const s = snapshot?.selections ?? []
    return {
      active: s.filter((x) => x.outcome === '進行中' || x.outcome === '合格').length,
      offer: s.filter((x) => x.outcome === '内定').length,
      closed: s.filter((x) => x.outcome === '不合格' || x.outcome === '辞退').length,
      appointments: snapshot?.appointments.length ?? 0,
      pending: snapshot?.pending.length ?? 0,
      mail: snapshot?.mail.length ?? 0,
    }
  }, [snapshot])

  const options = [
    { value: 'selections', content: `選考 ${snapshot?.selections.length ?? 0}` },
    { value: 'appointments', content: `予定 ${counts.appointments}` },
    { value: 'pending', content: `要確認 ${counts.pending}` },
    { value: 'mail', content: `要対応メール ${counts.mail}` },
  ]

  return (
    <>
      <header className="board-header">
        <div className="board-header-inner">
          <Cluster align="center" gap={0.75}>
            <Text weight="bold">katazuku board</Text>
            <Text size="S" color="TEXT_GREY">就活の状態を見るための、読み取り専用の窓</Text>
          </Cluster>
        </div>
      </header>

      <main className="board-shell">
        <Stack gap={1.5}>
          <Heading type="blockTitle">ボード</Heading>

          {error && <InformationPanel type="error" heading="読み込めません" toggleable={false}><Text>{error}</Text></InformationPanel>}

          {!snapshot && !error && <Center><Loader text="読み込み中" /></Center>}

          {snapshot && (
            <>
              {snapshot.demo && (
                <InformationPanel type="warning" heading="デモデータを表示しています" toggleable={false}>
                  <Text>
                    架空の企業・予定・メールです。自分のデータを見るには
                    <code> npm run board:snapshot </code>
                    を実行してから再読み込みしてください(書き出した snapshot.json はコミットされません)。
                  </Text>
                </InformationPanel>
              )}

              <Cluster gap={0.75}>
                <Tile label="進行中" value={counts.active} />
                <Tile label="内定" value={counts.offer} />
                <Tile label="終了" value={counts.closed} />
                <Tile label="要対応メール" value={counts.mail} tone="attention" />
                <Tile label="確認待ち" value={counts.pending} tone="attention" />
              </Cluster>

              <Section>
                <Stack gap={1}>
                  <Cluster align="center" justify="space-between" gap={1}>
                    <Heading type="sectionTitle">一覧</Heading>
                    <Text size="S" color="TEXT_GREY">
                      {formatAt(snapshot.generatedAt)} 時点
                    </Text>
                  </Cluster>

                  <SegmentedControl
                    options={options}
                    value={tab}
                    onClickOption={(v) => setTab(v as TabId)}
                    aria-label="表示する一覧"
                  />

                  <Base overflow="auto">
                    {tab === 'selections' && <SelectionsTable rows={snapshot.selections} />}
                    {tab === 'appointments' && <AppointmentsTable rows={snapshot.appointments} />}
                    {tab === 'pending' && <PendingTable rows={snapshot.pending} />}
                    {tab === 'mail' && <MailTable rows={snapshot.mail} />}
                  </Base>
                </Stack>
              </Section>

              <Text size="S" color="TEXT_GREY">
                このボードは正本DBへ書き込みません。状態を変えるのはエージェントと本人だけです。
              </Text>
            </>
          )}
        </Stack>
      </main>
    </>
  )
}
