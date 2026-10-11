import { startConnection } from './connection.mjs';
import { checkFirstSyncConfig, launchFirstSync } from './first-sync.mjs';
import { DEFAULT_BROKER_ORIGIN } from './scopes.mjs';

const args = process.argv.slice(2);
const options = {};
let sync = false;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace') { options.replace = true; continue; }
    if (args[i] === '--record-demo') { options.recordDemo = true; continue; }
    if (args[i] === '--sync') { sync = true; continue; }
    if (args[i] === '--help') {
      console.log('node tools/google-workspace/connect.mjs --account <Googleメールアドレス> [--replace] [--sync]\n任意: --broker <HTTPSオリジン> --credentials-dir <保存先> --record-demo\n--sync は認証成功後、このPCで予定・メールの初回同期を開始します。事前に katazuku.config.json とAIを設定してください。');
      process.exit(0);
    }
    const names = { '--account': 'account', '--broker': 'broker', '--credentials-dir': 'credentialsDirectory' };
    const name = names[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('引数が不正です。--helpを参照してください。');
    options[name] = args[++i];
  }
  if (sync) {
    if (options.recordDemo) throw new Error('審査用録画と初回同期は同時に実行できません。');
    if (options.broker && options.broker !== DEFAULT_BROKER_ORIGIN) throw new Error('初回同期は既定のGoogle認証サービスで接続するときだけ使えます。');
    checkFirstSyncConfig(options.account, options.credentialsDirectory);
    options.onConnected = async () => {
      try {
        await launchFirstSync();
        return 'Google接続を保存しました。予定とメールの初回同期を開始しました。進捗は logs/google-first-sync.local.json で確認できます。';
      } catch {
        return 'Google接続を保存しました。初回同期は起動できませんでした。ターミナルとPCの設定を確認してください。';
      }
    };
  }
  const connection = await startConnection({ ...options, spreadsheetId: process.env.KATAZUKU_GOOGLE_SPREADSHEET_ID });
  console.log(`katazuku Google接続: ${connection.url}/`);
  console.log('このPCのブラウザで開いてください。終了するときはCtrl+Cを押します。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => connection.close().then(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
