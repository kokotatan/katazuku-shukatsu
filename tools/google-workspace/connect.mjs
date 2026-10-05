import { startConnection } from './connection.mjs';

const args = process.argv.slice(2);
const options = {};
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace') { options.replace = true; continue; }
    if (args[i] === '--record-demo') { options.recordDemo = true; continue; }
    if (args[i] === '--help') {
      console.log('node tools/google-workspace/connect.mjs --account <Googleメールアドレス> [--replace]\n任意: --broker <HTTPSオリジン> --credentials-dir <保存先> --record-demo\nGoogleの同意は表示されたPCのブラウザで本人が行ってください。');
      process.exit(0);
    }
    const names = { '--account': 'account', '--broker': 'broker', '--credentials-dir': 'credentialsDirectory' };
    const name = names[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('引数が不正です。--helpを参照してください。');
    options[name] = args[++i];
  }
  const connection = await startConnection({ ...options, spreadsheetId: process.env.KATAZUKU_GOOGLE_SPREADSHEET_ID });
  console.log(`katazuku Google接続: ${connection.url}/`);
  console.log('このPCのブラウザで開いてください。終了するときはCtrl+Cを押します。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => connection.close().then(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
