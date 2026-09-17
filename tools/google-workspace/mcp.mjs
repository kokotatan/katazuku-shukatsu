import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { credentialPath, inspectCredential } from './doctor.mjs';
import { DEFAULT_BROKER_ORIGIN, GOOGLE_SCOPES } from './scopes.mjs';

export const WORKSPACE_MCP_VERSION = '1.23.0';

// 旧クライアントの秘密やOAuth設定を共通接続へ引き継がない。
export function commonMcpLaunch({ account, credentialsDirectory, environment = process.env } = {}) {
  const path = credentialPath(account, credentialsDirectory);
  let stored;
  try { stored = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('共通Google接続がありません。先に google:connect を実行してください。'); }
  const metadata = inspectCredential(stored);
  if (!metadata.clientConfigured || !metadata.refreshAvailable || stored.client_secret !== ''
      || stored.token_uri !== DEFAULT_BROKER_ORIGIN + '/token'
      || !Array.isArray(stored.scopes) || stored.scopes.length !== GOOGLE_SCOPES.length
      || new Set(stored.scopes).size !== GOOGLE_SCOPES.length
      || GOOGLE_SCOPES.some(scope => !stored.scopes.includes(scope))) {
    throw new Error('9権限の共通Google接続が必要です。既存の接続は変更していません。');
  }
  const env = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => !/^(GOOGLE_|WORKSPACE_|MCP_|FASTMCP_|USER_GOOGLE_EMAIL$)/i.test(key)));
  Object.assign(env, {
    USER_GOOGLE_EMAIL: account,
    GOOGLE_OAUTH_CLIENT_ID: stored.client_id,
    GOOGLE_OAUTH_CLIENT_SECRET: '',
    WORKSPACE_MCP_CREDENTIALS_DIR: resolve(path, '..'),
    MCP_ENABLE_OAUTH21: 'false',
    MCP_SINGLE_USER_MODE: '1',
    KATAZUKU_COMMON_GOOGLE_SCOPES: JSON.stringify(GOOGLE_SCOPES),
    KATAZUKU_COMMON_GOOGLE_TOKEN_URI: DEFAULT_BROKER_ORIGIN + '/token',
    PYTHONIOENCODING: 'utf-8',
  });
  const bundledUvx = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uvx.exe' : 'uvx');
  return {
    command: existsSync(bundledUvx) ? bundledUvx : 'uvx',
    args: ['--from', `workspace-mcp==${WORKSPACE_MCP_VERSION}`, 'python', fileURLToPath(new URL('./mcp_runtime.py', import.meta.url))],
    env,
  };
}

async function main() {
  const options = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log('node tools/google-workspace/mcp.mjs --account <メールアドレス> [--credentials-dir <保存先>]');
      return;
    }
    const key = { '--account': 'account', '--credentials-dir': 'credentialsDirectory' }[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('引数が不正です。--helpを参照してください。');
    options[key] = argv[++i];
  }
  const launch = commonMcpLaunch(options);
  const child = spawn(launch.command, launch.args, { env: launch.env, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  let finished = false;
  const stop = () => {
    if (finished || !child.pid) return;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  };
  process.stdin.pipe(child.stdin);
  process.stdin.once('end', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  process.once('exit', stop);
  child.on('error', () => { console.error('Google Workspace MCPを起動できません。uvのインストールを確認してください。'); process.exitCode = 1; });
  child.on('exit', (code) => { finished = true; process.exit(code ?? 1); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
