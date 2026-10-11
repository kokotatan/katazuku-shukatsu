import { strict as assert } from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { aggregateFunnel, funnelCsv } from '../src/analytics-export.js'

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE selection (submitted INTEGER NOT NULL, status TEXT NOT NULL, company_name TEXT, memo TEXT)')
const insert = db.prepare('INSERT INTO selection VALUES (?, ?, ?, ?)')
insert.run(0, '検討中', '秘密の企業', '個人のメモ')
insert.run(1, '最終面接通過', '秘密の企業', '個人のメモ')
insert.run(1, 'お見送り', '秘密の企業', '個人のメモ')
const csv = funnelCsv(aggregateFunnel(db))
assert.match(csv, /^stage,outcome,selection_count\n/)
assert.match(csv, /応募前,進行中,1/)
assert.match(csv, /応募済,合格,1/)
assert.match(csv, /応募済,不合格,1/)
assert.doesNotMatch(csv, /秘密の企業|個人のメモ|最終面接|お見送り/)
assert.equal(csv.trim().split('\n').length, 11)
assert.throws(() => funnelCsv([{ stage: '=1+1' as never, outcome: '進行中', selection_count: 1 }]))
db.close()
console.log('集計CSV: 固定カテゴリ・件数・自由記述の排除を確認')
