import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GOOGLE_SCOPES } from '../tools/google-workspace/scopes.mjs';
import { checkFirstSyncConfig, hasFirstSyncScopes, prepareFirstSync, readFirstSyncStatus, runFirstSync } from '../tools/google-workspace/first-sync.mjs';

const workspace = mkdtempSync(join(tmpdir(), 'katazuku-first-sync-'));
const credentialsDirectory = join(workspace, 'credentials');
const configPath = join(workspace, 'katazuku.config.json');
const account = 'person@example.com';
try {
  assert.throws(() => checkFirstSyncConfig(account, credentialsDirectory, { workspace, env: {} }), /katazuku.config.json/);
  assert.equal(prepareFirstSync(account, credentialsDirectory, { workspace, env: {} }).reason, 'missing_config');
  assert.throws(() => prepareFirstSync(account, credentialsDirectory, { mode: 'required', workspace, env: {} }), /katazuku.config.json/);
  writeFileSync(configPath, JSON.stringify({ google: { accounts: [{ id: 'main', email: account, primary: true }], credentialsDir: credentialsDirectory } }));
  assert.equal(checkFirstSyncConfig(account, credentialsDirectory, { workspace, env: {} }).configPath, configPath);
  assert.equal(prepareFirstSync(account, credentialsDirectory, { workspace, env: {} }).enabled, true);
  assert.equal(prepareFirstSync(account, credentialsDirectory, { mode: 'off', workspace, env: {} }).enabled, false);
  assert.equal(prepareFirstSync(account, credentialsDirectory, { standardConnection: false, workspace, env: {} }).enabled, false);
  assert.throws(() => prepareFirstSync(account, credentialsDirectory, { mode: 'required', standardConnection: false, workspace, env: {} }), /既定のGoogle認証サービス/);
  assert.equal(hasFirstSyncScopes([...GOOGLE_SCOPES]), true);
  assert.equal(hasFirstSyncScopes(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/calendar.events']), false);
  assert.equal(hasFirstSyncScopes(['https://www.googleapis.com/auth/gmail.modify']), false);
  assert.throws(() => checkFirstSyncConfig('other@example.com', credentialsDirectory, { workspace, env: {} }), /対象Googleアカウント/);
  assert.throws(() => prepareFirstSync('other@example.com', credentialsDirectory, { workspace, env: {} }), /対象Googleアカウント/);
  assert.throws(() => checkFirstSyncConfig('Person@example.com', credentialsDirectory, { workspace, env: {} }), /対象Googleアカウント/);
  assert.throws(() => checkFirstSyncConfig(account, join(workspace, 'other'), { workspace, env: {} }), /保存先/);
  assert.throws(() => checkFirstSyncConfig(undefined, credentialsDirectory, { workspace, env: {} }), /Googleアカウント/);

  const called = [];
  await runFirstSync({ workspace, runId: 'current-run', now: () => new Date('2026-10-11T00:00:00Z'), runWorkflow: async name => { called.push(name); } });
  assert.deepEqual(called, ['calendar-sync', 'daily-sync']);
  const statusPath = join(workspace, 'logs', 'google-first-sync.local.json');
  assert.equal(JSON.parse(readFileSync(statusPath, 'utf8')).status, 'complete');
  assert.deepEqual(readFirstSyncStatus({ workspace, runId: 'current-run' }), { status: 'complete' });
  assert.deepEqual(readFirstSyncStatus({ workspace, runId: 'previous-run' }), { status: 'unknown' });
  assert.equal(readFirstSyncStatus({ workspace }), undefined);
  assert.ok(!readFileSync(statusPath, 'utf8').includes(account));

  const failed = [];
  await assert.rejects(runFirstSync({ workspace, runId: 'failed-run', runWorkflow: async name => { failed.push(name); throw new Error('失敗の詳細'); } }), /失敗の詳細/);
  assert.deepEqual(failed, ['calendar-sync']);
  const failure = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.phase, 'calendar-sync');
  assert.deepEqual(readFirstSyncStatus({ workspace, runId: 'failed-run' }), { status: 'failed', phase: 'calendar-sync' });
  assert.deepEqual(readFirstSyncStatus({ workspace, runId: 'current-run' }), { status: 'unknown' });
  assert.ok(!JSON.stringify(failure).includes('失敗の詳細'));
  console.log('Google初回同期: 自動開始と明示停止、権限・アカウント・保存先の照合、予定→メールの順序、失敗時停止を確認');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
