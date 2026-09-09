import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)),'dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};
createServer((req,res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  let file = resolve(root,'.'+path);
  if (file !== root && !file.startsWith(root+sep)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file,'index.html');
  const status = existsSync(file) && statSync(file).isFile() ? 200 : 404;
  if (status === 404) file = join(root,'404.html');
  const extension = file.slice(file.lastIndexOf('.'));
  res.writeHead(status,{'Content-Type':types[extension]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:readFileSync(file));
}).listen(4184,'127.0.0.1',()=>console.log('公開HPプレビュー: http://127.0.0.1:4184/'));
