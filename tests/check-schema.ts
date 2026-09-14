/**
 * schemas/*.json が壊れていない(正しいJSON・構造)ことと、設定スキーマの既定値が型と
 * 整合していることを検証する。依存ゼロの自前assert。
 *   npm run test:schema
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas')

let failed = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${label}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failed++
}

const files = readdirSync(schemasDir).filter((f) => f.endsWith('.json'))
check('schemas/ に JSON がある', files.length > 0, `${files.length}件`)

for (const f of files) {
  let schema: any
  try { schema = JSON.parse(readFileSync(join(schemasDir, f), 'utf8')) } catch (e) {
    check(`${f}: 正しいJSON`, false, (e as Error).message); continue
  }
  check(`${f}: 正しいJSON`, true)
  check(`${f}: type または $ref を持つ`, typeof schema.type === 'string' || '$ref' in schema)
  if (schema.type === 'object') check(`${f}: object なら properties を持つ`, schema.properties && typeof schema.properties === 'object')
}

// 設定スキーマの既定値が型・enum と整合しているか(設定UIの生成元なので厳しめに)
const settings = JSON.parse(readFileSync(join(schemasDir, 'settings.schema.json'), 'utf8'))
function walk(props: Record<string, any>, path: string) {
  for (const [k, p] of Object.entries(props)) {
    const at = path ? `${path}.${k}` : k
    if (p.type === 'object' && p.properties) { walk(p.properties, at); continue }
    check(`${at}: default を持つ`, 'default' in p)
    if ('default' in p) {
      const d = p.default
      if (p.enum) check(`${at}: default が enum に含まれる`, p.enum.includes(d))
      if (p.type === 'array') {
        check(`${at}: default が配列`, Array.isArray(d))
        if (p.items?.enum && Array.isArray(d)) check(`${at}: 配列の各要素が items.enum に含まれる`, d.every((x: unknown) => p.items.enum.includes(x)))
      } else if (p.type === 'boolean') check(`${at}: default が真偽値`, typeof d === 'boolean')
      else if (p.type === 'integer') check(`${at}: default が整数`, Number.isInteger(d))
      else if (p.type === 'string' && !p.enum) check(`${at}: default が文字列`, typeof d === 'string')
    }
  }
}
if (settings.properties) walk(settings.properties, '')

if (failed) { console.error(`\n${failed}件失敗`); process.exit(1) }
console.log('\nすべて通過')
