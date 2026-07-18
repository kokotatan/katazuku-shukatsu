/**
 * 既存の人物・基本情報シードを正本DBへ移行する。
 * data:image は data/private/photos へ分離し、DBにはstorage_keyとsha256のみを保存する。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, resolveCompany } from '../src/db'
import { transaction, upsertPerson } from '../src/inputs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0 ? resolve(process.argv[dbArgIndex + 1]) : (process.env.KATAZUKU_DB_PATH || join(ROOT, 'data', 'katazuku.db'))
const PHOTO_ROOT = join(ROOT, 'data', 'private', 'photos')

function stripImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImages)
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.startsWith('data:image/') ? '' : value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/photo|image|picture/i.test(key)) continue
    output[key] = stripImages(child)
  }
  return output
}

function findImage(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('data:image/')) return value
  if (!value || typeof value !== 'object') return ''
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findImage(child)
    if (found) return found
  }
  return ''
}

function saveDataImage(dataUrl: string, storageKey: string): { sha256: string; storageKey: string } {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s.exec(dataUrl)
  if (!match) throw new Error('未対応の画像形式です')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const finalKey = storageKey.replace(/\.[^.]+$/, '') + '.' + extension
  const buffer = Buffer.from(match[2], 'base64')
  const target = join(PHOTO_ROOT, finalKey)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, buffer)
  return { storageKey: finalKey.replace(/\\/g, '/'), sha256: createHash('sha256').update(buffer).digest('hex') }
}

export function importPrivate(peoplePath: string, profilePath: string): { people: number; personPhotos: number; profile: boolean } {
  const peopleSeed = JSON.parse(readFileSync(resolve(peoplePath), 'utf8')) as Record<string, unknown>[]
  const profileSeed = JSON.parse(readFileSync(resolve(profilePath), 'utf8')) as Record<string, unknown>
  if (!Array.isArray(peopleSeed)) throw new Error('people seed は配列です')
  const db = openDb(DB_PATH)
  return transaction(db, () => {
    let personPhotos = 0
    for (const raw of peopleSeed) {
      const name = String(raw.name || '').trim()
      if (!name) continue
      const company = String(raw.company || '')
      const resolution = company ? resolveCompany(db, company) : { kind: 'new' as const }
      const companyId = resolution.kind === 'hit' ? resolution.companyId : undefined
      const personId = upsertPerson(db, {
        name,
        companyId,
        company,
        role: String(raw.role || ''),
        category: String(raw.category || ''),
        metAt: String(raw.metAt || ''),
        howMet: String(raw.howMet || ''),
        followUp: String(raw.followUp || ''),
      })
      const notes = String(raw.notes || '').trim()
      if (notes) {
        db.prepare(`
          INSERT OR IGNORE INTO person_note (person_id, at, note, source_ref, confidence)
          VALUES (?, ?, ?, 'seed:people-import', 1)
        `).run(personId, String(raw.updatedAt || raw.metAt || new Date().toISOString()), notes)
      }
      const image = findImage(raw)
      if (image) {
        const saved = saveDataImage(image, `people/person-${personId}`)
        db.prepare(`
          INSERT INTO person_photo (person_id, storage_key, sha256, verified_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(person_id) DO UPDATE SET
            storage_key = excluded.storage_key, sha256 = excluded.sha256, verified_at = excluded.verified_at
        `).run(personId, saved.storageKey, saved.sha256, new Date().toISOString())
        personPhotos += 1
      }
    }

    const profileSource = (profileSeed.basic && typeof profileSeed.basic === 'object')
      ? profileSeed.basic as Record<string, unknown>
      : profileSeed
    const profile = stripImages(profileSource) as Record<string, unknown>
    const profileImage = findImage(profileSource)
    if (profileImage) {
      const saved = saveDataImage(profileImage, 'profile/basic')
      profile.photoKey = saved.storageKey
    }
    db.prepare(`
      INSERT INTO profile_basic (id, data_json, updated_at, updated_by)
      VALUES (1, ?, ?, 'seed-import')
      ON CONFLICT(id) DO UPDATE SET
        data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(JSON.stringify(profile), new Date().toISOString())
    return { people: peopleSeed.length, personPhotos, profile: true }
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const peoplePath = process.argv[2]
  const profilePath = process.argv[3]
  if (!peoplePath || !profilePath) throw new Error('使い方: npx tsx scripts/db-import-private.ts <people.json> <profile.json>')
  console.log(JSON.stringify(importPrivate(peoplePath, profilePath), null, 2))
}
