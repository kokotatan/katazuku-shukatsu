import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  console.error(`google-workspace MCP を起動できません: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
