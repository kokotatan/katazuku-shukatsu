/** Google接続後、設定済みの標準接続で初回の取込みを開始する。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, renameSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOOGLE_SCOPES } from './scopes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultCredentials = join(homedir(), '.google_workspace_mcp', 'credentials');
const expandHome = path => path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path;

export function firstSyncConfigPath({ workspace = root, env = process.env } = {}) {
  return resolve(env.KATAZUKU_CONFIG?.trim() || join(workspace, 'katazuku.config.json'));
}

export function hasFirstSyncScopes(scopes) {
  // 共通MCP入口も7権限の完全一致を要求する。部分許可では先に進めない。
  return Array.isArray(scopes) && GOOGLE_SCOPES.every(scope => scopes.includes(scope));
}

/** 標準接続では設定済みなら自動開始。明示指定は設定不足を認証前に拒否する。 */
export function prepareFirstSync(account, credentialsDirectory, {
  mode = 'auto', standardConnection = true, workspace = root, env = process.env,
} = {}) {
  if (mode === 'off') return { enabled: false, reason: 'disabled' };
  if (!standardConnection) {
    if (mode === 'required') throw new Error('初回同期は既定のGoogle認証サービスで接続するときだけ使えます。');
    return { enabled: false, reason: 'nonstandard_connection' };
  }
  const configPath = firstSyncConfigPath({ workspace, env });
  if (mode === 'auto' && !existsSync(configPath)) return { enabled: false, reason: 'missing_config' };
  return { enabled: true, ...checkFirstSyncConfig(account, credentialsDirectory, { workspace, env }) };
}

/** 認証前に設定と保存先を照合する。違うアカウントの記録を取り込まない。 */
export function checkFirstSyncConfig(account, credentialsDirectory, { workspace = root, env = process.env } = {}) {
  if (typeof account !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('初回同期のGoogleアカウントを指定してください。');
  const configPath = firstSyncConfigPath({ workspace, env });
  if (!existsSync(configPath)) throw new Error('初回同期には katazuku.config.json が必要です。docs/SETUP.md に従って設定してください。');
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('初回同期の設定ファイルを読めません。katazuku.config.json を確認してください。'); }
  const accounts = config?.google?.accounts;
  if (!Array.isArray(accounts) || !accounts.some(item => item?.email === account)) {
    throw new Error('初回同期の対象Googleアカウントが katazuku.config.json に同じ表記で登録されていません。');
  }
  if (config.google.credentialsDir !== undefined && typeof config.google.credentialsDir !== 'string') {
    throw new Error('初回同期の資格情報保存先が不正です。');
  }
  const configuredDirectory = resolve(expandHome(config.google.credentialsDir || defaultCredentials));
  if (configuredDirectory !== resolve(credentialsDirectory || defaultCredentials)) {
    throw new Error('初回同期の資格情報保存先が katazuku.config.json と一致しません。');
  }
  return { configPath, workspace };
}

function updateStatus(path, status) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(status, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

function workflow(name, workspace, logPath) {
  return new Promise((resolveRun, reject) => {
    const runner = join(workspace, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!existsSync(runner)) return reject(new Error('npm ci を実行してから初回同期をやり直してください。'));
    const fd = openSync(logPath, 'a', 0o600);
    const child = spawn(process.execPath, [runner, join(workspace, 'scripts', 'workflow.ts'), name], {
      cwd: workspace, env: process.env, windowsHide: true, stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    const timeout = setTimeout(() => child.kill(), 45 * 60_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolveRun() : reject(new Error(`${name} が完了しませんでした（exit ${code}）。`)); });
  });
}

/** 自分のPCで順に実行。失敗時は後続を始めず、状態と詳細ログをローカルへ残す。 */
export async function runFirstSync({ workspace = root, runWorkflow = workflow, now = () => new Date(), runId = process.env.KATAZUKU_FIRST_SYNC_RUN_ID || randomUUID() } = {}) {
  const logs = join(workspace, 'logs');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const statusPath = join(logs, 'google-first-sync.local.json');
  const logPath = join(logs, 'google-first-sync.local.log');
  const startedAt = now().toISOString();
  for (const name of ['calendar-sync', 'daily-sync']) {
    updateStatus(statusPath, { runId, status: 'running', phase: name, startedAt });
    try { await runWorkflow(name, workspace, logPath); }
    catch (error) {
      updateStatus(statusPath, { runId, status: 'failed', phase: name, startedAt, finishedAt: now().toISOString(),
        message: `${name} を完了できませんでした。ローカルの詳細ログを確認してください。` });
      throw error;
    }
  }
  updateStatus(statusPath, { runId, status: 'complete', startedAt, finishedAt: now().toISOString(), message: '予定とメールの初回同期が完了しました。' });
  return statusPath;
}

/** 画面には固定の状態と工程だけを返し、ログ・アカウント・例外文は渡さない。 */
export function readFirstSyncStatus({ workspace = root, runId } = {}) {
  if (!runId) return undefined;
  try {
    const value = JSON.parse(readFileSync(join(workspace, 'logs', 'google-first-sync.local.json'), 'utf8'));
    if (value.runId !== runId) return { status: 'unknown' };
    if (!['queued', 'running', 'complete', 'failed'].includes(value.status)) return { status: 'unknown' };
    const phase = ['calendar-sync', 'daily-sync'].includes(value.phase) ? value.phase : undefined;
    return { status: value.status, ...(phase ? { phase } : {}) };
  } catch { return { status: 'unknown' }; }
}

/** OAuthコールバックを待たせずに、初回同期をローカルの別プロセスへ渡す。 */
export function launchFirstSync({ workspace = root, configPath } = {}) {
  return new Promise((resolveLaunch, reject) => {
    const logs = join(workspace, 'logs');
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    const statusPath = join(logs, 'google-first-sync.local.json');
    const runId = randomUUID();
    updateStatus(statusPath, { runId, status: 'queued', startedAt: new Date().toISOString() });
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: workspace, env: { ...process.env, ...(configPath ? { KATAZUKU_CONFIG: configPath } : {}), KATAZUKU_FIRST_SYNC_RUN_ID: runId },
      windowsHide: true, detached: true, stdio: 'ignore',
    });
    child.once('error', error => {
      try { updateStatus(statusPath, { runId, status: 'failed', startedAt: new Date().toISOString() }); }
      catch { /* 起動エラーを優先して呼び出し元へ返す。 */ }
      reject(error);
    });
    child.once('spawn', () => { child.unref(); resolveLaunch(runId); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const statusPath = await runFirstSync();
    console.log(`初回同期完了: ${statusPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '初回同期を完了できませんでした。');
    process.exitCode = 1;
  }
}
