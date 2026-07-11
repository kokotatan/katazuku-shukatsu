import { useRef, useState } from 'react'
import { Button, Dialog, Input } from 'smarthr-ui'

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
    <Dialog isOpen width="32rem" onClickOverlay={onClose} onPressEscape={onClose}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">設定・連携</h2>
          <Button size="S" variant="text" onClick={onClose}>
            閉じる
          </Button>
        </div>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-700">Gmail と直接連携</h3>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Google Cloud Console で OAuth クライアントID(ウェブアプリ /
            承認済みオリジンに <code className="rounded bg-slate-100 px-1">http://localhost:5173</code>)
            を作成し、貼り付けてください。メールは読み取り専用で、データはこの端末にのみ保存されます。
          </p>
          <div className="flex gap-2">
            <Input
              width="100%"
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
            />
            <Button
              variant="primary"
              onClick={() => {
                onSaveClientId(idDraft.trim())
                onConnectGmail()
              }}
              disabled={!idDraft.trim() || connecting}
            >
              {connecting ? '取得中…' : '接続'}
            </Button>
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold text-slate-700">JSONインポート / エクスポート</h3>
          <p className="mb-2 text-xs leading-relaxed text-slate-500">
            Claude(Gmail MCP連携)などで書き出したメールJSONを取り込めます。形式:
            <code className="rounded bg-slate-100 px-1">
              {'[{id, from, fromAddress, subject, body, receivedAt}]'}
            </code>
          </p>
          <div className="flex gap-2">
            <Button size="S" variant="secondary" onClick={() => fileRef.current?.click()}>
              インポート
            </Button>
            <Button size="S" variant="secondary" onClick={onExportJson}>
              エクスポート
            </Button>
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
          <h3 className="mb-2 text-sm font-bold text-slate-700">データ</h3>
          <Button size="S" variant="danger" onClick={onResetDemo}>
            デモデータにリセット
          </Button>
        </section>
      </div>
    </Dialog>
  )
}
