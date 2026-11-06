// 白紙ページの追加と削除。
// 元PDFを書き換えるのではなく sheets に差し込む。
// 書き出すまで元のバイト列には一切触らない
import { startBlankDocument } from './doc'
import { renderPage } from './render'
import { pageCount, releaseUnusedImages, S, sheetSize } from './state'
import { setStatus } from './status'

export async function addBlank() {
  if (pageCount() === 0) {
    await startBlankDocument()
    return
  }

  // 隣のページと同じ見た目の寸法にする。
  // 回転ページでも入れ替えた寸法が返るので, 白紙側の回転は常に0でよい。
  // つまり placementToPdf は default の枝しか通らない
  const { w, h } = await sheetSize(S.pageIndex)
  const at = S.pageIndex + 1

  S.sheets.splice(at, 0, { kind: 'blank', width: w, height: h })
  for (const p of S.placements) if (p.sheetIndex >= at) p.sheetIndex++

  S.pageIndex = at
  S.selectedId = null

  await renderPage()
  setStatus(`${at + 1} ページ目に白紙を追加しました`)
}

export async function dropBlank() {
  const s = S.sheets[S.pageIndex]
  if (!s || s.kind !== 'blank') return

  const at = S.pageIndex
  const lost = S.placements.filter(p => p.sheetIndex === at).length

  S.sheets.splice(at, 1)
  S.placements = S.placements.filter(p => p.sheetIndex !== at)
  for (const p of S.placements) if (p.sheetIndex > at) p.sheetIndex--

  releaseUnusedImages()        // 一緒に外れた画像の ImageBitmap を閉じる

  // 最後の1枚を消すと 0 ページになる。
  // pageIndex を -1 にしないこと。syncControls が最初の画面に戻す
  S.pageIndex = Math.max(0, Math.min(at, pageCount() - 1))
  S.selectedId = null

  await renderPage()

  if (pageCount() === 0) {
    setStatus('白紙ページを削除しました。PDF を開くか,「白紙を追加」で始めてください')
    return
  }
  setStatus(
    lost > 0
      ? `白紙ページを削除しました (貼ってあった画像 ${lost} 枚も外れました)`
      : '白紙ページを削除しました',
  )
}
