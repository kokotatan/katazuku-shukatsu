// 受信トレイのフラット化(daily-sync 手順6)を google-workspace MCP 経由で一括実行する。
// 未読の積み残しが数百件になるとエージェントが1件ずつ扱うのは非現実的なため、
// 検索のページングとラベル操作のバッチをこのスクリプトに寄せる。
//
// 使い方:
//   node scripts/inbox-tidy.mjs [--keep=<messageId>,<messageId>...] [--dry-run]
//
// 動作:
//   1. 就活サービス媒体の is:unread older_than:7d に TRASH を付ける
//   2. それ以外の is:unread older_than:1d から UNREAD を外す(--keep で指定したIDは残す)
//   当日(1日以内)の未読は対象外。削除は媒体メルマガのみ。
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEDIA_DOMAINS = [
  "slogan.jp", "br-campus.jp", "typeshukatsu.jp", "en-courage.com", "labbase.jp",
  "openwork.jp", "gaishishukatsu.com", "gakujo.ne.jp", "ibeck.co.jp", "offerbox.jp",
  "mynavi.jp", "rikunabi.com",
];
const USER = "okuyama.kotaro.career@gmail.com";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keep = new Set(
  (args.find((a) => a.startsWith("--keep="))?.slice("--keep=".length) ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

const claudeConfig = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
const source = claudeConfig?.mcpServers?.["google-workspace"];
if (!source?.command || !Array.isArray(source.args) || !source.env) {
  throw new Error("Claude Code の google-workspace MCP 設定が見つかりません");
}
const bundledUvx = join(homedir(), ".local", "bin", "uvx.exe");
const command = source.command === "uvx" && existsSync(bundledUvx) ? bundledUvx : source.command;

const child = spawn(command, source.args, {
  env: { ...process.env, ...source.env },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
child.stderr.on("data", () => {});

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
    try { message = JSON.parse(line); } catch { continue; }
    const resolver = pending.get(message.id);
    if (resolver) { pending.delete(message.id); resolver(message); }
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
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args) {
  const result = await send("tools/call", { name, arguments: args });
  return (result.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
}

/** 検索結果テキストから Message ID を全部拾う(ページを辿って重複排除) */
async function searchAll(query) {
  const ids = new Set();
  let pageToken = null;
  for (let page = 0; page < 40; page++) {
    const text = await call("search_gmail_messages", {
      query, page_size: 100, user_google_email: USER,
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    const found = [...text.matchAll(/Message ID: ([0-9a-f]+)/g)].map((m) => m[1]);
    const before = ids.size;
    for (const id of found) ids.add(id);
    const next = text.match(/page_token='([^']+)'/);
    if (!next || found.length === 0 || ids.size === before) break;
    pageToken = next[1];
  }
  return [...ids];
}

async function modifyInChunks(ids, { add, remove }) {
  let done = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await call("batch_modify_gmail_message_labels", {
      message_ids: chunk, user_google_email: USER,
      ...(add ? { add_label_ids: add } : {}),
      ...(remove ? { remove_label_ids: remove } : {}),
    });
    done += chunk.length;
  }
  return done;
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "katazuku-inbox-tidy", version: "1.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const mediaQuery = `is:unread older_than:7d (${MEDIA_DOMAINS.map((d) => `from:${d}`).join(" OR ")})`;
  const trashIds = (await searchAll(mediaQuery)).filter((id) => !keep.has(id));
  const readIds = (await searchAll("is:unread older_than:1d"))
    .filter((id) => !keep.has(id) && !trashIds.includes(id));

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, trash: trashIds.length, markRead: readIds.length, kept: keep.size }));
  } else {
    const trashed = trashIds.length ? await modifyInChunks(trashIds, { add: ["TRASH"] }) : 0;
    const marked = readIds.length ? await modifyInChunks(readIds, { remove: ["UNREAD"] }) : 0;
    console.log(JSON.stringify({ trashed, markedRead: marked, kept: keep.size }));
  }
} finally {
  child.stdin.end();
  child.kill();
}
