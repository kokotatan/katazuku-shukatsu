import { useState } from 'react'
import { Button } from 'smarthr-ui'

export default function LocalLoginGuide() {
  const [copyMessage, setCopyMessage] = useState('')
  return (
    <section className="flex flex-col gap-5 py-4" aria-labelledby="local-login-title">
      <div>
        <h2 id="local-login-title" className="text-xl font-bold">自動ログイン</h2>
        <p className="mt-2 text-sm leading-7 text-slate-600">毎日ログインするサービス・ログインURL・時刻を設定します。サービス名は候補から選ぶか、自分で入力できます。設定画面は、実行するWindows PCで開きます。</p>
      </div>
      <div className="rounded border border-slate-300 p-5">
        <h3 className="font-bold">このPCの設定画面を開く</h3>
        <p className="mt-2 text-sm leading-7 text-slate-600">起動済みなら、下のボタンから設定できます。スマートフォンや別のPCには設定を引き継ぎません。</p>
        <a href="http://127.0.0.1:18471/board/local-login/" target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded bg-blue-600 px-4 text-sm font-bold text-white">自動ログイン設定を開く</a>
      </div>
      <div>
        <h3 className="font-bold">初めて使うとき・画面が開かないとき</h3>
        <p className="mt-2 text-sm leading-7 text-slate-600">Windows PCのkatazukuフォルダで <code>scripts/open-local-login-settings.vbs</code> をダブルクリックします。Node.jsとChromeが必要です。</p>
        <details className="mt-3">
          <summary className="cursor-pointer py-2 text-sm text-blue-700">ターミナルから起動する</summary>
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded bg-slate-100 p-3">
            <code className="break-all text-sm">npm run local-login:settings</code>
            <Button size="S" type="button" onClick={async () => {
              try { await navigator.clipboard.writeText('npm run local-login:settings'); setCopyMessage('コピーしました') }
              catch { setCopyMessage('コマンドを選択してコピーしてください') }
            }}>コピー</Button>
            <span role="status" className="text-xs text-slate-600">{copyMessage}</span>
          </div>
        </details>
      </div>
      <p className="border-t border-slate-300 pt-4 text-sm leading-7 text-slate-600">ログイン情報は、入力したPCのWindowsユーザー用に暗号化して保存します。Googleログインや追加認証が必要な場合は、専用Chromeで本人が操作します。</p>
    </section>
  )
}
