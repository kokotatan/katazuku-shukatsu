import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const out = join(root,'dist');
const failures = [];
const pages = [];
function walk(path) { for (const name of readdirSync(path)) { const file = join(path,name); if (statSync(file).isDirectory()) walk(file); else { if (/\.(db|sqlite|map)$/.test(name) || name.startsWith('.env') || name.includes('snapshot')) failures.push('公開禁止ファイル: '+file); if (name.endsWith('.html')) pages.push(file); } } }
walk(out);
for (const file of pages) {
  const html = readFileSync(file,'utf8');
  const label = file.slice(out.length);
  if ((html.match(/<h1[\s>]/g)||[]).length !== 1) failures.push(label+': h1は一つ');
  for (const tag of ['<title>','name="description"','rel="canonical"','lang="ja"']) if (!html.includes(tag)) failures.push(label+': '+tag);
  if (!file.endsWith('404.html') && /content="noindex/.test(html)) failures.push(label+': noindex');
  for (const match of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) { try { JSON.parse(match[1]); } catch { failures.push(label+': 構造化データが不正'); } }
  for (const [,link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (!link.startsWith('/') && !link.startsWith('#')) continue;
    const [path,anchor] = link.split('#');
    let target = !path ? file : join(out,path);
    if (path.endsWith('/')) target = join(target,'index.html');
    if (!existsSync(target)) { failures.push(label+': リンク切れ '+link); continue; }
    if (anchor && target.endsWith('.html') && !readFileSync(target,'utf8').includes(`id="${anchor}"`)) failures.push(label+': アンカーなし '+link);
  }
  if (/(奥山[\s　]*彪太郎|okuyama\.|okuyama-kotaro|ui-preview|KATAZUKU_READ_SECRET=)/i.test(html)) failures.push(label+': 個人情報またはテスト値');
}
for (const file of ['sitemap.xml','robots.txt','llms.txt','feed.xml']) if (!existsSync(join(out,file))) failures.push('ファイルなし: '+file);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`公開HP検証: ${pages.length} HTMLのリンク・アンカー・メタ情報・構造化データ・公開禁止ファイル検査に成功`);
