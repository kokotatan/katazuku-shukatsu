import { useRef, useState } from 'react'

interface Props {
  clientId: string
  connecting: boolean
  onSaveClientId: (id: string) => void
  onConnectGmail: () => void
  onImportJson: (text: string) => void
  onExportJson: () => void
  onResetDemo: () => void
  onClose: () => void
}

export function SettingsModal({
  clientId,
  connecting,
  onSaveClientId,
  onConnectGmail,
  onImportJson,
  onExportJson,
  onResetDemo,
  onClose,
}: Props) {
  const [idDraft, setIdDraft] = useState(clientId)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">⚙ 設定・連携</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-700">📧 Gmail と直接連携</h3>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Google Cloud Console で OAuth クライアントID(ウェブアプリ /
            承認済みオリジンに <code className="rounded bg-slate-100 px-1">http://localhost:5173</code>)
            を作成し、貼り付けてください。メールは読み取り専用で、データはこの端末にのみ保存されます。
          </p>
          <div className="flex gap-2">
            <input
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <button
              onClick={() => {
                onSaveClientId(idDraft.trim())
                onConnectGmail()
              }}
              disabled={!idDraft.trim() || connecting}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {connecting ? '取得中…' : '接続'}
            </button>
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-700">📂 JSONインポート / エクスポート</h3>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Claude(Gmail MCP連携)などで書き出したメールJSONを取り込めます。形式:
            <code className="rounded bg-slate-100 px-1">
              {'[{id, from, fromAddress, subject, body, receivedAt}]'}
            </code>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              ⬆ インポート
            </button>
            <button
              onClick={onExportJson}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              ⬇ エクスポート
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) onImportJson(await file.text())
                e.target.value = ''
              }}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-bold text-slate-700">🧪 データ</h3>
          <button
            onClick={onResetDemo}
            className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            デモデータにリセット
          </button>
        </section>
      </div>
    </div>
  )
}
