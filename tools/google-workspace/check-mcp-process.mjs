import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commonMcpLaunch } from './mcp.mjs';
import { credentialPath } from './doctor.mjs';
import { GOOGLE_SCOPES, DEFAULT_BROKER_ORIGIN } from './scopes.mjs';

// MCPの実プロセスを起動する。架空の資格情報しか使わず、Google API呼び出しは行わない。
const directory = mkdtempSync(join(tmpdir(), 'katazuku-mcp-process-'));
const account = 'person@example.com';
writeFileSync(credentialPath(account, directory), JSON.stringify({ token: 'example-token', refresh_token: 'example-refresh',
  client_id: '123-example.apps.googleusercontent.com', client_secret: '', token_uri: DEFAULT_BROKER_ORIGIN + '/token',
  scopes: GOOGLE_SCOPES, expiry: new Date(Date.now() + 3_600_000).toISOString() }));
let child;
let finished = false;
try {
  const launch = commonMcpLaunch({ account, credentialsDirectory: directory });
  child = spawn(launch.command, launch.args, { env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  let id = 0;
  const pending = new Map();
  child.stderr.on('data', () => {});
  child.on('exit', () => { finished = true; for (const reject of pending.values()) reject(new Error('MCPが終了しました')); });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      pending.get(message.id)?.(message);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('MCPの応答がありません')); }, 120_000);
    pending.set(requestId, message => {
      clearTimeout(timer);
      pending.delete(requestId);
      if (message instanceof Error) reject(message);
      else if (message.error) reject(new Error('MCPプロトコルエラー'));
      else resolve(message.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'katazuku-common-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { tools } = await request('tools/list', {});
  const names = tools.map(tool => tool.name);
  for (const name of ['search_gmail_messages', 'list_calendars', 'search_drive_files', 'read_sheet_values']) assert.ok(names.includes(name), name);
  for (const name of ['create_calendar', 'get_gmail_filters', 'create_gmail_filter']) assert.ok(!names.includes(name), name);
  const denied = await request('tools/call', { name: 'search_gmail_messages', arguments: {
    user_google_email: 'someone@example.com', query: 'test', page_size: 1,
  } });
  assert.equal(denied.isError, true);
  assert.doesNotMatch(JSON.stringify(denied), /accounts\.google\.com|example-token|example-refresh/);
  console.log(`共通MCP実プロセス: 起動・${names.length}ツール・権限による除外・アカウント拒否を検証しました。`);
} finally {
  if (child?.pid && !finished) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  }
  rmSync(directory, { recursive: true, force: true });
}
