// 描画とツールバーの同期。
// renderPage は「紙を描く」, syncControls は「ボタンの状態を state から導く」,
// redraw は「紙以外を描き直す」。役割を分けてあるので,
// ボタンの状態を直したいだけで pdf.js の再描画は起きない
import { AREA_PAD, HANDLE_PX, MAX_RENDER_SCALE, ZOOM_STEPS } from './constants'
import { CORNERS, cornersOf } from './coords'
import {
  addBlankButton, dropBlankButton, emptyState, exportButton, nextButton, overlay,
  pageCanvas, pageNo, pageTotal, peelButton, prevButton, sheetArea, stage,
  zoomFit, zoomIn, zoomNow, zoomOut,
} from './dom'
import { syncList } from './list'
import { pageCount, pagePlacements, S, sheetSize } from './state'

// 表示領域に収まる倍率。倍率100% = ページ全体が見える状態
export function fitScale(pw: number, ph: number) {
  const r = sheetArea.getBoundingClientRect()
  const w = Math.max(200, r.width - AREA_PAD)
  const h = Math.max(200, r.height - AREA_PAD)
  return Math.max(0.1, Math.min(w / pw, h / ph))
}

export function drawOverlay() {
  const ctx = overlay.getContext('2d')!

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, overlay.width, overlay.height)              // 実ピクセルで全消去
  ctx.setTransform(S.pixelRatio, 0, 0, S.pixelRatio, 0, 0)        // 以降は CSS px で描く

  for (const p of pagePlacements()) {
    const img = S.images.get(p.imageId)
    if (!img) continue

    const x = p.dx * S.viewScale, y = p.dy * S.viewScale
    const w = p.dw * S.viewScale, h = p.dh * S.viewScale

    ctx.drawImage(img.bitmap, x, y, w, h)
    if (p.id !== S.selectedId) continue

    // 白と青の二重線。下の紙が明るくても画像が暗くても枠が見える
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, w, h)
    ctx.strokeStyle = '#1b5fbf'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x, y, w, h)

    const cs = cornersOf(p)
    for (const key of CORNERS) {
      const c = cs[key]
      const hx = c.x * S.viewScale - HANDLE_PX / 2
      const hy = c.y * S.viewScale - HANDLE_PX / 2
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(hx, hy, HANDLE_PX, HANDLE_PX)
      ctx.strokeStyle = '#1b5fbf'
      ctx.lineWidth = 1.5
      ctx.strokeRect(hx, hy, HANDLE_PX, HANDLE_PX)
    }
  }
}

// ツールバーと作業面の状態は, 全部ここだけで state から導く。
// 「開いた」「閉じた」を別に持たないので, 最後の白紙を削除したときも
// 自動で最初の画面に戻る
// 作業面と最初の画面の出し分け。
// fitScale で測る前にここだけ先に確定させたいので, 関数にしてある
function showStage(open: boolean) {
  emptyState.hidden = open
  stage.hidden = !open
}

export function syncControls() {
  const n = pageCount()
  const open = n > 0
  const isBlank = S.sheets[S.pageIndex]?.kind === 'blank'

  showStage(open)

  pageNo.disabled = !open
  pageNo.value = open ? String(S.pageIndex + 1) : '1'
  pageNo.max = String(Math.max(1, n))
  pageTotal.textContent = open ? String(n) : '–'
  prevButton.disabled = !open || S.pageIndex <= 0
  nextButton.disabled = !open || S.pageIndex >= n - 1

  zoomNow.textContent = `${Math.round(ZOOM_STEPS[S.zoomIdx] * 100)}%`
  zoomFit.disabled = !open
  zoomOut.disabled = !open || S.zoomIdx <= 0
  zoomIn.disabled = !open || S.zoomIdx >= ZOOM_STEPS.length - 1

  addBlankButton.disabled = false              // 何も開いていなくても押せる
  dropBlankButton.disabled = !open || !isBlank // 元のページは消せない
  peelButton.disabled = S.selectedId === null
  exportButton.disabled = !open || S.exporting

  // canvas の中身は読み上げに乗らないので, 白紙であることは文字で出す
  stage.setAttribute(
    'aria-label',
    isBlank
      ? `${S.pageIndex + 1} ページ目 (追加した白紙)。画像をドラッグで動かし, 角をつかんで大きさを変えられます`
      : 'ページの作業面。画像をドラッグで動かし, 角をつかんで大きさを変えられます',
  )
}

export function redraw() {
  drawOverlay()
  syncList()
  syncControls()
}

// pdf.js の RenderTask。型を細かく当てる必要がないので最小限だけ書く
type RenderTask = { cancel(): void; promise: Promise<unknown> }

// renderPage は複数の入口 (ページ送り, 倍率, 白紙の追加削除, リサイズ, 棚の選択) から
// 呼ばれ, 中で2回 await する。直列化しないと, 先に始まった描画が後の描画を
// 上から塗り, viewScale などのモジュール変数も最後に走ったほうの値が残る。
// 結果として「紙は3ページ目, 座標系は5ページ目」という状態が作れてしまう。
// 世代番号で追い越されたほうを捨てる
let generation = 0
let active: RenderTask | null = null

export async function renderPage() {
  const my = ++generation
  if (active) {
    active.cancel()
    active = null
  }

  if (pageCount() === 0) {
    redraw()
    return
  }

  // 測る前に版面だけ確定させる。
  // #stage を出す前に fitScale を呼ぶと作業領域の高さが実際と変わり,
  // 「100%」と出ているのに紙がはみ出す (変更前はここで約5%ずれていた)。
  // ツールバーの同期は描き終わってから (最後の redraw) にする
  showStage(true)

  const sheet = S.sheets[S.pageIndex]

  // 白紙は元PDFに存在しないので pdf.js には渡せない。塗るだけで済ませる
  const page = sheet.kind === 'src' ? await S.pdfjsDoc!.getPage(sheet.srcIndex + 1) : null
  const { w: baseW, h: baseH } = await sheetSize(S.pageIndex)
  if (my !== generation) return      // 追い越された。canvas には触らない

  S.viewScale = fitScale(baseW, baseH) * ZOOM_STEPS[S.zoomIdx]

  // 画面の実ピクセル密度に合わせて描く。
  // これをしないと canvas が CSS px のまま引き伸ばされて表示がぼやける。
  // Windows の拡大縮小 125% なら devicePixelRatio は 1.25
  const dpr = window.devicePixelRatio || 1
  const renderScale = Math.min(S.viewScale * dpr, MAX_RENDER_SCALE)
  S.pixelRatio = renderScale / S.viewScale

  const viewport = page ? page.getViewport({ scale: renderScale }) : null

  S.displayW = baseW
  S.displayH = baseH

  const w = Math.floor(viewport ? viewport.width : baseW * renderScale)
  const h = Math.floor(viewport ? viewport.height : baseH * renderScale)
  const cssW = Math.round(w / S.pixelRatio)
  const cssH = Math.round(h / S.pixelRatio)

  // width/height は実ピクセル数, style は画面上の大きさ
  for (const cv of [pageCanvas, overlay]) {
    cv.width = w
    cv.height = h
    cv.style.width = `${cssW}px`
    cv.style.height = `${cssH}px`
  }

  const ctx = pageCanvas.getContext('2d')!
  // pdf.js は render のたびに自前の transform を残すので, 白紙を塗る前に戻す
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)

  if (page && viewport) {
    const task = page.render({ canvas: pageCanvas, canvasContext: ctx, viewport }) as RenderTask
    active = task
    try {
      await task.promise
    } catch (e) {
      // 追い越して cancel したときに必ず飛んでくる。これは異常ではない
      if ((e as Error)?.name !== 'RenderingCancelledException') throw e
    }
    if (active === task) active = null
    if (my !== generation) return
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }

  redraw()
}
