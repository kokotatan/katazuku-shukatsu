/**
 * 画像ファイルを canvas で長辺 maxPx に縮小し、JPEG(quality 0.82)の dataURL にする。
 * localStorage 肥大を防ぐため必ず縮小してから保存する(証明写真は maxPx=512 程度で呼ぶ)。
 * people アプリの同名ヘルパを参考に profile 内へ実装。
 */
export function readFileAsDataURL(file: File, maxPx = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('画像を解釈できませんでした'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas を利用できませんでした'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
