/**
 * 場所・参加形態・経路見積もり・確定移動をDBへ入れるCLI。
 * 住所を含むlist出力はローカル利用だけに限定する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../src/db'
import {
  addTravelSegment,
  listMobilityData,
  setAppointmentMobility,
  setMobilityProfile,
  upsertPlace,
  upsertRouteEstimate,
  type AppointmentMobilityInput,
  type MobilityProfileInput,
  type PlaceInput,
  type RouteEstimateInput,
  type TravelSegmentInput,
} from '../src/mobility'

const dbArgIndex = process.argv.indexOf('--db')
const DB_PATH = dbArgIndex >= 0
  ? resolve(process.argv[dbArgIndex + 1])
  : (process.env.KATAZUKU_DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'katazuku.db'))

function inputPath(): string {
  const args = process.argv.slice(3)
  const clean = args.filter((arg, index) => arg !== '--db' && args[index - 1] !== '--db')
  if (!clean[0]) throw new Error('JSONファイルを指定してください')
  return clean[0]
}

function readInput<T>(): T {
  return JSON.parse(readFileSync(resolve(inputPath()), 'utf8')) as T
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  const command = process.argv[2]
  const db = openDb(DB_PATH)
  try {
    let result: unknown
    switch (command) {
      case 'place':
        result = upsertPlace(db, readInput<PlaceInput>())
        break
      case 'profile':
        result = setMobilityProfile(db, readInput<MobilityProfileInput>())
        break
      case 'appointment':
        result = setAppointmentMobility(db, readInput<AppointmentMobilityInput>())
        break
      case 'route':
        result = upsertRouteEstimate(db, readInput<RouteEstimateInput>())
        break
      case 'segment':
        result = addTravelSegment(db, readInput<TravelSegmentInput>())
        break
      case 'list':
        result = listMobilityData(db)
        break
      default:
        throw new Error(
          '使い方: npx tsx scripts/db-mobility.ts ' +
          '<place|profile|appointment|route|segment> <input.json> [--db <path>] または list',
        )
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    db.close()
  }
}
