// google-workspace MCP を直接叩く最小クライアント。
// Claude Code 側の MCP 接続が30秒タイムアウトで落ちても、asa/daily-sync が
// Gmail・カレンダーへ到達できるようにするための代替経路。
//
// 使い方:
//   node scripts/ws-mcp-call.mjs calls.json [out.json]
//     calls.json = [{ "name": "search_gmail_messages", "arguments": { ... } }, ...]
//   node scripts/ws-mcp-call.mjs --list
//
// 1プロセスで複数呼び出しをまとめて処理する(起動コストが重いため)。
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const claudeConfig = JSON.parse(
  readFileSync(join(homedir(), ".claude.json"), "utf8"),
);
const source = claudeConfig?.mcpServers?.["google-workspace"];
if (!source?.command || !Array.isArray(source.args) || !source.env) {
  throw new Error("Claude Code の google-workspace MCP 設定が見つかりません");
}

const bundledUvx = join(homedir(), ".local", "bin", "uvx.exe");
const command = source.command === "uvx" && existsSync(bundledUvx)
  ? bundledUvx
  : source.command;

const child = spawn(command, source.args, {
  env: { ...process.env, ...source.env },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
child.stderr.on("data", () => {}); // サーバーのログは捨てる

let nextId = 1;
const pending = new Map();
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // JSON-RPC 以外の出力は無視
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} が応答しません(180秒)`));
    }, 180_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        return;
      }
      resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const callsPath = args.find((arg) => !arg.startsWith("--"));
const outPath = args.filter((arg) => !arg.startsWith("--"))[1];

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "katazuku-ws-mcp-call", version: "1.0.0" },
  });
  notify("notifications/initialized", {});

  if (listOnly) {
    const tools = await send("tools/list", {});
    // --schema=名前,名前 を付けると入力スキーマも出す
    const wanted = args
      .find((arg) => arg.startsWith("--schema="))
      ?.slice("--schema=".length)
      .split(",");
    if (wanted) {
      for (const tool of tools.tools.filter((t) => wanted.includes(t.name))) {
        console.log(`### ${tool.name}`);
        console.log(JSON.stringify(tool.inputSchema?.properties ?? {}));
        console.log(`required: ${JSON.stringify(tool.inputSchema?.required ?? [])}`);
      }
    } else {
      console.log(tools.tools.map((tool) => tool.name).join("\n"));
    }
  } else {
    if (!callsPath) throw new Error("呼び出し定義のJSONパスを指定してください");
    const calls = JSON.parse(readFileSync(callsPath, "utf8"));
    const results = [];
    for (const call of calls) {
      try {
        const result = await send("tools/call", {
          name: call.name,
          arguments: call.arguments ?? {},
        });
        const text = (result.content ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        results.push({ name: call.name, ok: !result.isError, text });
      } catch (error) {
        results.push({ name: call.name, ok: false, text: String(error.message) });
      }
    }
    const json = JSON.stringify(results, null, 2);
    if (outPath) writeFileSync(outPath, json, "utf8");
    else console.log(json);
  }
} finally {
  child.stdin.end();
  child.kill();
}
