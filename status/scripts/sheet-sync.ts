/**
 * 選考管理シートへの書き戻し(サービスアカウント版)。
 * Claude Code やターミナルから直接実行できる。ブラウザのOAuth不要。
 *
 * 準備(1回だけ):
 *   1. Google Cloud Console でプロジェクト作成 → Google Sheets API を有効化
 *   2. サービスアカウントを作成し、JSONキーを pipeline/service-account.json に保存(gitignore済)
 *   3. 選考管理シートをサービスアカウントのメールアドレスに「編集者」で共有
 *
 * 実行:
 *   cd pipeline
 *   npx tsx scripts/sheet-sync.ts <ボードのJSON>           # 差分表示のみ(dry-run)
 *   npx tsx scripts/sheet-sync.ts <ボードのJSON> --apply   # 実際に書き込む
 *
 * ボードのJSONは Pipeline アプリの「⬇ エクスポート」で書き出したファイル。
 * 書き込みルールはアプリの「📤 シートに反映」と同一(lib/sheet.ts を共用):
 * 合格/不合格/辞退は上書きしない・メモや数式列に触れない・無い企業は空き行に追記。
 */
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_SHEET_ID, locateTable, planUpdates, type CellUpdate } from '../src/lib/sheet'
import type { Company } from '../src/types'

const KEY_PATH = process.env.GOOGLE_SA_KEY ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'service-account.json')
const SHEET_ID = process.env.SHEET_ID ?? DEFAULT_SHEET_ID
const API = 'https://sheets.googleapis.com/v4/spreadsheets'

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64url')
}

/** サービスアカウントのJWTでアクセストークンを取得する */
async function getToken(): Promise<string> {
  let key: { client_email: string; private_key: string }
  try {
    key = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
  } catch {
    console.error(`❌ サービスアカウントの鍵が読めません: ${KEY_PATH}`)
    console.error('   Google Cloud Console → サービスアカウント → キー(JSON)を作成して保存してください。')
    console.error('   別の場所に置く場合は環境変数 GOOGLE_SA_KEY でパスを指定できます。')
    process.exit(1)
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key)
  const assertion = `${header}.${claims}.${b64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`トークン取得に失敗 (${res.status}): ${await res.text()}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const boardPath = args.find((a) => !a.startsWith('--'))
  if (!boardPath) {
    console.error('使い方: npx tsx scripts/sheet-sync.ts <ボードのJSON> [--apply]')
    process.exit(1)
  }

  const companies: Company[] = JSON.parse(readFileSync(boardPath, 'utf8'))
  console.log(`ボード: ${companies.length}社 / シート: ${SHEET_ID}`)

  const token = await getToken()

  // 「企業名」列を持つタブを探す
  const metaRes = await fetch(`${API}/${SHEET_ID}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!metaRes.ok) throw new Error(`シートにアクセスできません (${metaRes.status})。サービスアカウントに共有されているか確認してください。`)
  const meta = (await metaRes.json()) as { sheets?: { properties: { title: string } }[] }

  for (const s of meta.sheets ?? []) {
    const title = s.properties.title
    const range = encodeURIComponent(`'${title}'!A1:T500`)
    const dataRes = await fetch(`${API}/${SHEET_ID}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!dataRes.ok) continue
    const rows: string[][] = ((await dataRes.json()) as { values?: string[][] }).values ?? []
    const table = locateTable(rows)
    if (!table) continue

    const plan = planUpdates(companies, rows, table)
    console.log(`\nタブ「${title}」: 更新 ${plan.updatedNames.length}社 / 追記 ${plan.addedNames.length}社 / ${plan.updates.length}セル`)
    if (plan.updatedNames.length) console.log(`  🔄 ${plan.updatedNames.join('、')}`)
    if (plan.addedNames.length) console.log(`  ➕ ${plan.addedNames.join('、')}`)
    if (plan.skipped.length) console.log(`  ⚠ 空き行不足: ${plan.skipped.join('、')}`)

    if (plan.updates.length === 0) {
      console.log('差分なし。シートは最新です 🎉')
      return
    }
    if (!apply) {
      console.log('\n(dry-run でした。書き込むには --apply を付けて実行)')
      return
    }

    const colLetter = (i: number) => {
      let s = ''
      let n = i + 1
      while (n > 0) {
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s
        n = Math.floor((n - 1) / 26)
      }
      return s
    }
    const writeRes = await fetch(`${API}/${SHEET_ID}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: plan.updates.map((u: CellUpdate) => ({
          range: `'${title}'!${colLetter(u.col)}${u.row + 1}`,
          values: [[u.value]],
        })),
      }),
    })
    if (!writeRes.ok) throw new Error(`書き込み失敗 (${writeRes.status}): ${await writeRes.text()}`)
    console.log('\n✅ シートに書き込みました')
    return
  }
  throw new Error('「企業名」「出願状況」列を持つ表が見つかりませんでした')
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
