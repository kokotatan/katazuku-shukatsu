const briefs = document.getElementById('briefs')
async function reloadBriefs() {
  briefs.replaceChildren()
  try {
    const response = await fetch('/api/briefs', { cache: 'no-store' })
    if (!response.ok) throw new Error('取得できませんでした')
    const rows = await response.json()
    if (!rows.length) {
      const message = document.createElement('p')
      message.textContent = 'まだまとめはありません。朝のまとめ・前夜の準備の設定と実行結果を確認してください。'
      briefs.append(message)
    }
    for (const row of rows) {
      const heading = document.createElement('h3')
      heading.textContent = `${row.kind === 'asa' ? '朝のまとめ' : '前夜の準備'} — ${row.date}`
      const body = document.createElement('pre')
      body.textContent = row.text
      briefs.append(heading, body)
    }
  } catch {
    briefs.textContent = 'まとめを読み込めませんでした。ローカル閲覧サーバーが動いているか確認して、再読込してください。'
  }
}
document.getElementById('reload').addEventListener('click', reloadBriefs)
fetch('/api/viewer').then((response) => {
  if (!response.ok) throw new Error('取得できませんでした')
  return response.json()
}).then(({ mode }) => {
  const demo = mode === 'demo'
  document.getElementById('mode').textContent = demo ? '架空データのデモ' : '自分のデータ（ローカル閲覧）'
  document.getElementById('mode-description').textContent = demo
    ? 'アカウントには接続していません。画面にある予定・企業・まとめは架空の例です。'
    : '正本DBから作成したスナップショットを表示します。データがなくても架空データへ切り替えません。'
}).catch(() => { document.getElementById('mode').textContent = '接続を確認してください' })
reloadBriefs()
