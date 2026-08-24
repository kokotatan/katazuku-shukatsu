import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { blockedToolResult, evaluateWorkspaceToolCall } from "./workspace-mcp-policy.mjs";

const claudeConfigPath = join(homedir(), ".claude.json");
const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf8"));
const source = claudeConfig?.mcpServers?.["google-workspace"];

if (!source?.command || !Array.isArray(source.args) || !source.env) {
  throw new Error("Claude Code の google-workspace MCP 設定が見つかりません");
}

const requiredEnvKeys = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "USER_GOOGLE_EMAIL",
];

for (const key of requiredEnvKeys) {
  if (typeof source.env[key] !== "string" || source.env[key].length === 0) {
    throw new Error(`Claude Code の google-workspace MCP 設定に ${key} がありません`);
  }
}

// Claude Code の単一アカウント固定だけを外し、ツール構成はそのまま共有する。
const startupCheck = process.argv.includes("--check-startup");
const args = startupCheck
  ? ["workspace-mcp", "--help"]
  : source.args.filter((arg) => arg !== "--single-user");
const bundledUvx = join(homedir(), ".local", "bin", "uvx.exe");
const command = source.command === "uvx" && existsSync(bundledUvx)
  ? bundledUvx
  : source.command;

const child = spawn(command, args, {
  env: { ...process.env, ...source.env },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

// stdio MCPの親(Claude/Codex)が終了しても、uvx -> workspace-mcp -> Python が
// Windows上で孤立して残ることがある。stdinの終了とプロセスシグナルを終了境界として
// 子孫ツリーを確実に回収する。秘密を含み得るcommand lineはログへ出さない。
let childExited = false;
let shutdownStarted = false;
let shutdownTimer = null;

function forceStopChildTree() {
  if (childExited || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try { child.kill("SIGKILL"); } catch {}
}

function beginShutdown(reason, exitCode = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  try { child.stdin.end(); } catch {}
  shutdownTimer = setTimeout(() => {
    forceStopChildTree();
    if (!childExited) process.exit(exitCode);
  }, 1500);
  // MCPの診断ログには理由だけを残し、環境変数やcommand lineは出さない。
  console.error(`google-workspace MCP bridgeを終了します: ${reason}`);
}

// MCPのtools/callを中継する地点で、第三者宛send_gmail_messageは本人が確認した
// tool callとの完全一致を検証する。
// allowedToolsやプロンプトはモデルが見る境界だが、ここはprovider/モデルに依存しない最終防壁。
const selfEmails = [
  source.env.USER_GOOGLE_EMAIL,
  ...(process.env.KATAZUKU_SELF_EMAILS || '').split(','),
].map((value) => value.trim()).filter(Boolean);
const workspaceCapabilities = (process.env.KATAZUKU_WORKSPACE_CAPABILITIES || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
let approvedWorkspaceCall;
try {
  const encoded = process.env.KATAZUKU_APPROVED_WORKSPACE_CALL_B64 || '';
  approvedWorkspaceCall = encoded
    ? JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    : undefined;
} catch {
  throw new Error('KATAZUKU_APPROVED_WORKSPACE_CALL_B64が不正です');
}
delete process.env.KATAZUKU_APPROVED_WORKSPACE_CALL_B64;

let stdinBuffer = '';
function forwardLine(line) {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    const verdict = evaluateWorkspaceToolCall(message, selfEmails, workspaceCapabilities, approvedWorkspaceCall);
    if (!verdict.allow) {
      process.stdout.write(JSON.stringify(blockedToolResult(message.id, verdict.reason)) + '\n');
      return;
    }
    if (verdict.consumeApproval) approvedWorkspaceCall = undefined;
  } catch {
    // JSON-RPC以外の入力は子へそのまま渡し、bridgeがプロトコルを壊さないようにする。
  }
  child.stdin.write(line + '\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split(/\r?\n/);
  stdinBuffer = lines.pop() || '';
  for (const line of lines) forwardLine(line);
});
process.stdin.on('end', () => {
  if (stdinBuffer) forwardLine(stdinBuffer);
  beginShutdown('stdin-end');
});
process.stdin.on('close', () => beginShutdown('stdin-close'));
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => beginShutdown(signal, 1));
}
process.once("exit", forceStopChildTree);
process.once("uncaughtException", (error) => {
  console.error(`google-workspace MCP bridgeで未処理例外: ${error.message}`);
  forceStopChildTree();
  process.exit(1);
});
process.once("unhandledRejection", (error) => {
  console.error(`google-workspace MCP bridgeで未処理拒否: ${String(error)}`);
  forceStopChildTree();
  process.exit(1);
});

child.on("error", (error) => {
  console.error(`google-workspace MCP を起動できません: ${error.message}`);
  beginShutdown('child-error', 1);
});

child.on("exit", (code, signal) => {
  childExited = true;
  if (shutdownTimer) clearTimeout(shutdownTimer);
  process.exit(signal ? 1 : (code ?? 1));
});
