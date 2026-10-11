import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFirstSyncConfig, runFirstSync } from '../tools/google-workspace/first-sync.mjs';

const workspace = mkdtempSync(join(tmpdir(), 'katazuku-first-sync-'));
const credentialsDirectory = join(workspace, 'credentials');
const configPath = join(workspace, 'katazuku.config.json');
const account = 'person@example.com';
try {
  assert.throws(() => checkFirstSyncConfig(account, credentialsDirectory, { workspace, env: {} }), /katazuku.config.json/);
  writeFileSync(configPath, JSON.stringify({ google: { accounts: [{ id: 'main', email: account, primary: true }], credentialsDir: credentialsDirectory } }));
  assert.equal(checkFirstSyncConfig(account, credentialsDirectory, { workspace, env: {} }).configPath, configPath);
  assert.throws(() => checkFirstSyncConfig('other@example.com', credentialsDirectory, { workspace, env: {} }), /対象Googleアカウント/);
  assert.throws(() => checkFirstSyncConfig('Person@example.com', credentialsDirectory, { workspace, env: {} }), /対象Googleアカウント/);
  assert.throws(() => checkFirstSyncConfig(account, join(workspace, 'other'), { workspace, env: {} }), /保存先/);
  assert.throws(() => checkFirstSyncConfig(undefined, credentialsDirectory, { workspace, env: {} }), /Googleアカウント/);

  const called = [];
  await runFirstSync({ workspace, now: () => new Date('2026-10-11T00:00:00Z'), runWorkflow: async name => { called.push(name); } });
  assert.deepEqual(called, ['calendar-sync', 'daily-sync']);
  const statusPath = join(workspace, 'logs', 'google-first-sync.local.json');
  assert.equal(JSON.parse(readFileSync(statusPath, 'utf8')).status, 'complete');
  assert.ok(!readFileSync(statusPath, 'utf8').includes(account));

  const failed = [];
  await assert.rejects(runFirstSync({ workspace, runWorkflow: async name => { failed.push(name); throw new Error('失敗の詳細'); } }), /失敗の詳細/);
  assert.deepEqual(failed, ['calendar-sync']);
  const failure = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.phase, 'calendar-sync');
  assert.ok(!JSON.stringify(failure).includes('失敗の詳細'));
  console.log('Google初回同期: アカウントと保存先の照合、予定→メールの順序、失敗時停止、状態の秘密非出力を確認');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
