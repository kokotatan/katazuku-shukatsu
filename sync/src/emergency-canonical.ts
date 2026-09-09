import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

export const EMERGENCY_CANONICAL_FILE = '.katazuku-emergency-canonical.local.json'

export interface EmergencyCanonicalLease {
  schemaVersion: 1
  status: 'active' | 'paused' | 'ended'
  failoverId: string
  host: string
  canonicalHost: string
  sourceDatabaseId: string
  sourcePath: string
  activatedAt: string
  leaseExpiresAt: string
  hardExpiresAt: string
  reason: string
}

export interface EmergencyCanonicalState {
  active: boolean
  reason: string
  lease?: EmergencyCanonicalLease
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/**
 * 衛星機を一時正本に昇格させる期限付きリースを検証する。
 * 期限、端末名、状態のどれかが一致しなければ必ず閉じる(fail closed)。
 */
export function inspectEmergencyCanonicalLease(
  repositoryRoot: string,
  options: { now?: Date; host?: string } = {},
): EmergencyCanonicalState {
  const path = join(repositoryRoot, EMERGENCY_CANONICAL_FILE)
  if (!existsSync(path)) return { active: false, reason: 'lease_missing' }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { active: false, reason: 'lease_invalid_json' }
  }
  if (!value || typeof value !== 'object') return { active: false, reason: 'lease_invalid' }
  const lease = value as Partial<EmergencyCanonicalLease>
  if (lease.schemaVersion !== 1 || lease.status !== 'active') {
    return { active: false, reason: `lease_${lease.status || 'invalid'}` }
  }
  const currentHost = (options.host || process.env.COMPUTERNAME || hostname()).toLowerCase()
  if (!lease.host || lease.host.toLowerCase() !== currentHost) {
    return { active: false, reason: 'lease_host_mismatch' }
  }
  if (!validDate(lease.leaseExpiresAt) || !validDate(lease.hardExpiresAt)) {
    return { active: false, reason: 'lease_date_invalid' }
  }
  const now = (options.now || new Date()).getTime()
  if (Date.parse(lease.leaseExpiresAt) <= now) return { active: false, reason: 'lease_expired' }
  if (Date.parse(lease.hardExpiresAt) <= now) return { active: false, reason: 'hard_expired' }
  if (!lease.failoverId || !lease.canonicalHost || !lease.sourceDatabaseId || !lease.sourcePath || !lease.activatedAt) {
    return { active: false, reason: 'lease_fields_missing' }
  }
  return { active: true, reason: 'active', lease: lease as EmergencyCanonicalLease }
}

export function isEmergencyCanonical(repositoryRoot: string): boolean {
  return inspectEmergencyCanonicalLease(repositoryRoot).active
}
