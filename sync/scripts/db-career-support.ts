/** 支援組織/面談の確認CLI。個人データを含むため出力先ファイルは作らない。 */
import { openDb } from '../src/db'
import { ensureCareerSupportSchema } from '../src/career-support'
import { resolveDatabasePath } from '../src/database-path'

const db = openDb(resolveDatabasePath())
ensureCareerSupportSchema(db)
const query = (process.argv[2] || '').trim()
const pattern = `%${query}%`
const organizations = db.prepare(`
  SELECT id, name, short_name AS shortName, kind FROM career_organization
  WHERE ? = '' OR name LIKE ? OR short_name LIKE ? ORDER BY id
`).all(query, pattern, pattern)
const meetings = db.prepare(`
  SELECT m.id, o.name AS organization, m.title, m.start_at AS startAt, m.end_at AS endAt,
    m.status, m.external_id AS externalId, m.url
  FROM career_meeting m LEFT JOIN career_organization o ON o.id = m.organization_id
  WHERE ? = '' OR m.title LIKE ? OR o.name LIKE ? ORDER BY m.start_at DESC
`).all(query, pattern, pattern)
const selectionCount = (db.prepare(`
  SELECT count(*) AS count FROM selection s JOIN company c ON c.id = s.company_id
  WHERE ? <> '' AND (c.name LIKE ? OR c.short_name LIKE ?)
`).get(query, pattern, pattern) as { count: number }).count
const interviews = db.prepare(`
  SELECT i.id, i.selection_id AS selectionId, i.company_id AS companyId,
    i.organization_id AS organizationId, i.career_meeting_id AS careerMeetingId,
    i.title, i.source_ref AS sourceRef
  FROM interview_note i LEFT JOIN career_organization o ON o.id = i.organization_id
  WHERE ? = '' OR o.name LIKE ? OR i.title LIKE ? ORDER BY i.id DESC
`).all(query, pattern, pattern)
const placeholderPeople = (db.prepare("SELECT count(*) AS count FROM person WHERE name IN ('姓不明','氏名不明','名前不明','不明')")
  .get() as { count: number }).count
console.log(JSON.stringify({ organizations, meetings, interviews, matchingSelections: selectionCount, placeholderPeople }, null, 2))
