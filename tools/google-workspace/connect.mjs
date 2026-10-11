import { startConnection } from './connection.mjs';
import { checkFirstSyncConfig, hasFirstSyncScopes, launchFirstSync, prepareFirstSync, readFirstSyncStatus } from './first-sync.mjs';
import { DEFAULT_BROKER_ORIGIN } from './scopes.mjs';

const args = process.argv.slice(2);
const options = {};
let syncMode = 'auto';
let syncFlag = '';
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace') { options.replace = true; continue; }
    if (args[i] === '--record-demo') { options.recordDemo = true; continue; }
    if (args[i] === '--sync' || args[i] === '--no-sync') {
      if (syncFlag) throw new Error('--sync と --no-sync は同時に指定できません。');
      syncFlag = args[i]; syncMode = args[i] === '--sync' ? 'required' : 'off'; continue;
    }
    if (args[i] === '--help') {
      console.log('node tools/google-workspace/connect.mjs --account <Googleメールアドレス> [--replace] [--no-sync]\n任意: --sync --broker <HTTPSオリジン> --credentials-dir <保存先> --record-demo\n設定済みの標準接続では認証成功後、このPCで予定・メールの初回同期を開始します。--no-sync は接続だけ、--sync は設定不足を認証前にエラーにします。');
      process.exit(0);
    }
    const names = { '--account': 'account', '--broker': 'broker', '--credentials-dir': 'credentialsDirectory' };
    const name = names[args[i]];
    if (!name || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('引数が不正です。--helpを参照してください。');
    options[name] = args[++i];
  }
  const standardConnection = !options.recordDemo && (!options.broker || options.broker === DEFAULT_BROKER_ORIGIN);
  if (syncMode === 'required' && options.recordDemo) throw new Error('審査用録画と初回同期は同時に実行できません。');
  const syncPlan = prepareFirstSync(options.account, options.credentialsDirectory, { mode: syncMode, standardConnection });
  if (syncPlan.enabled) {
    const { configPath } = syncPlan;
    let activeSyncRunId;
    options.initialSync = true;
    options.readInitialSyncStatus = () => readFirstSyncStatus({ runId: activeSyncRunId });
    options.onConnected = async ({ scopes }) => {
      if (!hasFirstSyncScopes(scopes)) {
        return 'Google接続を保存しました。必要なGoogle権限が揃っていないため、初回同期は開始していません。権限を確認して再接続してください。';
      }
      try {
        checkFirstSyncConfig(options.account, options.credentialsDirectory);
        activeSyncRunId = await launchFirstSync({ configPath });
        return 'Google接続を保存しました。予定とメールの初回同期を開始しました。進捗はこの画面で確認できます。';
      } catch {
        return 'Google接続を保存しました。初回同期は起動できませんでした。ターミナルとPCの設定を確認してください。';
      }
    };
  } else if (syncPlan.reason === 'missing_config') {
    options.onConnected = async () => 'Google接続を保存しました。katazuku.config.json が未設定のため、初回同期は開始していません。設定後に --sync で再接続してください。';
  }
  const connection = await startConnection({ ...options, spreadsheetId: process.env.KATAZUKU_GOOGLE_SPREADSHEET_ID });
  console.log(`katazuku Google接続: ${connection.url}/`);
  console.log('このPCのブラウザで開いてください。終了するときはCtrl+Cを押します。');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => connection.close().then(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
