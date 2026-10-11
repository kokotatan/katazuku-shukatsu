/** Google接続後、本人が --sync を選んだときだけ初回の取込みを開始する。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, renameSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultCredentials = join(homedir(), '.google_workspace_mcp', 'credentials');
const expandHome = path => path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path;

/** 認証前に設定と保存先を照合する。違うアカウントの記録を取り込まない。 */
export function checkFirstSyncConfig(account, credentialsDirectory, { workspace = root, env = process.env } = {}) {
  if (typeof account !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('初回同期のGoogleアカウントを指定してください。');
  const configPath = resolve(env.KATAZUKU_CONFIG?.trim() || join(workspace, 'katazuku.config.json'));
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
export async function runFirstSync({ workspace = root, runWorkflow = workflow, now = () => new Date() } = {}) {
  const logs = join(workspace, 'logs');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const statusPath = join(logs, 'google-first-sync.local.json');
  const logPath = join(logs, 'google-first-sync.local.log');
  const startedAt = now().toISOString();
  for (const name of ['calendar-sync', 'daily-sync']) {
    updateStatus(statusPath, { status: 'running', phase: name, startedAt });
    try { await runWorkflow(name, workspace, logPath); }
    catch (error) {
      updateStatus(statusPath, { status: 'failed', phase: name, startedAt, finishedAt: now().toISOString(),
        message: `${name} を完了できませんでした。ローカルの詳細ログを確認してください。` });
      throw error;
    }
  }
  updateStatus(statusPath, { status: 'complete', startedAt, finishedAt: now().toISOString(), message: '予定とメールの初回同期が完了しました。' });
  return statusPath;
}

/** OAuthコールバックを待たせずに、初回同期をローカルの別プロセスへ渡す。 */
export function launchFirstSync({ workspace = root, configPath } = {}) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: workspace, env: { ...process.env, ...(configPath ? { KATAZUKU_CONFIG: configPath } : {}) },
      windowsHide: true, detached: true, stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolveLaunch(); });
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
