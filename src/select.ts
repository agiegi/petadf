// 配置の選択・はがす・拡縮。棚とキーボードの両方から呼ばれる
import { MIN_PT, PT_TO_MM } from './constants'
import { redraw, renderPage } from './render'
import { releaseUnusedImages, S, selected } from './state'
import { setStatus } from './status'

// 棚から選ぶ。別のページの画像ならそのページへ移動する
export async function pickPlacement(id: number) {
  const i = S.placements.findIndex(p => p.id === id)
  if (i < 0) return

  const p = S.placements[i]
  S.selectedId = p.id

  if (p.sheetIndex !== S.pageIndex) {
    S.pageIndex = p.sheetIndex
    await renderPage()
  } else {
    redraw()
  }
  setStatus(`画像 ${i + 1} を選びました`)
}

export function peelPlacement(id: number) {
  const i = S.placements.findIndex(p => p.id === id)
  if (i < 0) return

  S.placements = S.placements.filter(p => p.id !== id)
  if (S.selectedId === id) S.selectedId = null
  releaseUnusedImages()
  redraw()
  setStatus(`画像 ${i + 1} をはがしました`)
}

export function peelSelected() {
  if (S.selectedId === null) return
  S.placements = S.placements.filter(p => p.id !== S.selectedId)
  S.selectedId = null
  releaseUnusedImages()
  redraw()
  setStatus('はがしました')
}

export function scaleSelected(factor: number) {
  const p = selected()
  if (!p) return
  // 中心を保ったまま拡縮する
  const cx = p.dx + p.dw / 2
  const cy = p.dy + p.dh / 2
  const w = Math.max(MIN_PT, p.dw * factor)
  const h = w * (p.dh / p.dw)
  p.dw = w
  p.dh = h
  p.dx = cx - w / 2
  p.dy = cy - h / 2
  redraw()
  setStatus(`大きさ ${Math.round(w * PT_TO_MM)} × ${Math.round(h * PT_TO_MM)} mm`)
}
