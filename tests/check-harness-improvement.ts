import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunResult } from '../src/agent-runtime.js'
import {
  approveCandidate, ensureRegressionForObservation, evaluateHarnessCandidate,
  harnessImprovementSummary, ingestAgentRunArtifacts, observationFromRun, openHarnessImprovementStore,
  recordCandidateEvaluation, recordHarnessObservation, recordImprovementProposal,
} from '../src/harness-improvement.js'

const root = mkdtempSync(join(tmpdir(), 'katazuku-harness-improvement-'))
try {
  const db = openHarnessImprovementStore(join(root, 'improvement.db'))
  try {
    const run: AgentRunResult = {
      runId: 'run:mail:1', workflowId: 'mail-watch', status: 'needs_resume', provider: 'codex',
      sideEffectState: 'unknown', safeToFallback: false, failure: 'partial_side_effect', attempts: [{
        attemptId: 'attempt-1', provider: 'codex', phase: 'running', status: 'failed', failure: 'partial_side_effect',
        safeToFallback: false, startedAt: '2026-10-31T00:00:00Z', finishedAt: '2026-10-31T00:00:03Z',
      }],
    }
    const observation = observationFromRun(run, new Date('2026-10-31T00:01:00Z'))
    assert.equal(observation.sideEffectState, 'unknown')
    assert.equal(observation.durationMs, 3_000)
    assert.equal(recordHarnessObservation(db, observation).created, true)
    assert.equal(recordHarnessObservation(db, observation).created, false, 'runIdで観測を冪等化する')
    const regression = ensureRegressionForObservation(db, observation)
    assert.equal(regression.created, true)
    assert.equal(ensureRegressionForObservation(db, observation).created, false)
    const artifactRoot = join(root, 'agent-runs')
    mkdirSync(join(artifactRoot, 'run-2'), { recursive: true })
    writeFileSync(join(artifactRoot, 'run-2', 'run.local.json'), JSON.stringify({
      ...run, runId: 'run:mail:2', status: 'failed', sideEffectState: 'none', failure: 'invalid_output',
    }))
    mkdirSync(join(artifactRoot, 'broken'), { recursive: true })
    writeFileSync(join(artifactRoot, 'broken', 'run.local.json'), '{')
    const ingested = await ingestAgentRunArtifacts(db, artifactRoot, new Date('2026-10-31T00:02:00Z'))
    assert.deepEqual(ingested, { scanned: 2, observed: 1, regressions: 1, invalid: 1 })
    const stored = db.prepare('SELECT fixture_ref AS fixtureRef,expected_json AS expectedJson FROM harness_regression').get() as { fixtureRef: string; expectedJson: string }
    assert(stored.fixtureRef.startsWith('synthetic:'), '実メールやpromptをfixtureへ複製しない')
    assert.equal(JSON.parse(stored.expectedJson).automaticRetry, false)

    assert.equal(recordImprovementProposal(db, {
      candidateId: 'candidate:mail-reconcile:1', baseRevision: 'abcdef1', title: 'SENT照合を先行',
      rationale: '不明な送信結果で再送しないため', changes: ['reconcile工程を送信前後に固定', 'unknownを終端状態として記録'],
      risk: 'high', createdAt: '2026-10-31T01:00:00Z',
    }).created, true)
    const passingCases = [
      { caseId: 'safety-unknown', kind: 'safety' as const, required: true, baselinePassed: true, candidatePassed: true, baselineScore: 1, candidateScore: 1, baselineLatencyMs: 100, candidateLatencyMs: 105 },
      { caseId: 'quality-schema', kind: 'quality' as const, required: true, baselinePassed: true, candidatePassed: true, baselineScore: 0.8, candidateScore: 0.9, baselineLatencyMs: 100, candidateLatencyMs: 110 },
      { caseId: 'reliability-failover', kind: 'reliability' as const, required: true, baselinePassed: false, candidatePassed: true, baselineScore: 0.5, candidateScore: 0.9, baselineLatencyMs: 200, candidateLatencyMs: 190 },
    ]
    assert.equal(evaluateHarnessCandidate(passingCases).status, 'eligible_for_review')
    assert.equal(recordCandidateEvaluation(db, 'candidate:mail-reconcile:1', passingCases).status, 'eligible_for_review')
    assert.throws(() => approveCandidate(db, 'candidate:mail-reconcile:1', '', '1234567'), /approvedBy/)
    approveCandidate(db, 'candidate:mail-reconcile:1', '本人確認', '1234567')
    assert.equal((db.prepare('SELECT status FROM harness_candidate').get() as { status: string }).status, 'approved')

    const rejected = evaluateHarnessCandidate([
      { ...passingCases[0], candidatePassed: false, candidateScore: 0 }, passingCases[1], passingCases[2],
    ])
    assert.equal(rejected.status, 'rejected')
    assert(rejected.reasons.some((reason) => reason.includes('safety')))
    const summary = harnessImprovementSummary(db)
    assert.deepEqual(JSON.parse(JSON.stringify(summary.observations)), [
      { outcome: 'failed', count: 1 },
      { outcome: 'needs_resume', count: 1 },
    ])
    assert(!JSON.stringify(summary).includes('SENT照合を先行'), '運用summaryへ候補本文を出さない')
    console.log('harness改善ループ: 観測最小化・回帰fixture化・baseline比較・safety gate・人手昇格を確認')
  } finally { db.close() }
} finally { rmSync(root, { recursive: true, force: true }) }
