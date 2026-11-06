// ページ送りと拡大縮小
import { FIT_INDEX, ZOOM_STEPS } from './constants'
import { renderPage, syncControls } from './render'
import { pageCount, S } from './state'
import { setStatus } from './status'

export async function gotoPage(n: number) {
  const next = Math.min(Math.max(0, n), pageCount() - 1)
  if (next === S.pageIndex) {
    syncControls()      // 範囲外を入力されたときに入力欄を戻す
    return
  }
  S.pageIndex = next
  S.selectedId = null
  await renderPage()
  setStatus(`${S.pageIndex + 1} ページ目`)
}

export async function setZoom(idx: number) {
  const next = Math.min(Math.max(0, idx), ZOOM_STEPS.length - 1)
  if (next === S.zoomIdx) return
  S.zoomIdx = next
  await renderPage()
  setStatus(`表示倍率 ${Math.round(ZOOM_STEPS[S.zoomIdx] * 100)}%`)
}

export function zoomToFit() {
  return setZoom(FIT_INDEX)
}
