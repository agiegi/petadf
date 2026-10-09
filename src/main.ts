import { PDFDocument, degrees } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const pdfInput = document.getElementById('pdfInput') as HTMLInputElement
const imageInput = document.getElementById('imageInput') as HTMLInputElement
const prevButton = document.getElementById('prevButton') as HTMLButtonElement
const nextButton = document.getElementById('nextButton') as HTMLButtonElement
const deleteButton = document.getElementById('deleteButton') as HTMLButtonElement
const exportButton = document.getElementById('exportButton') as HTMLButtonElement
const pageLabel = document.getElementById('pageLabel') as HTMLSpanElement
const statusLine = document.getElementById('status') as HTMLDivElement
const pageCanvas = document.getElementById('pageCanvas') as HTMLCanvasElement
const overlay = document.getElementById('overlayCanvas') as HTMLCanvasElement

const TARGET_WIDTH = 760    // 表示したいページ幅 (px)
const HANDLE_PX = 9         // リサイズハンドルの辺 (px)
const MIN_PT = 20           // 画像の最小サイズ (pt)
const LOAD_MAX_EDGE = 3000  // 読み込み時の長辺上限 (px)
const EXPORT_DPI = 200      // 書き出し時の解像度
const JPEG_QUALITY = 0.85

// --- 型 ---

type Box = { x: number; y: number; width: number; height: number }

type StoredImage = {
  id: number
  bitmap: ImageBitmap    // EXIF適用済み, 縮小済み
  hasAlpha: boolean
}

type Placement = {
  id: number
  imageId: number
  pageIndex: number
  dx: number; dy: number; dw: number; dh: number   // 表示pt, 左上原点
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

type Drag =
  | { kind: 'move'; id: number; grabDx: number; grabDy: number }
  | { kind: 'resize'; id: number; corner: Corner; anchorX: number; anchorY: number; aspect: number }

// --- 状態 ---

let pdfData: ArrayBuffer | null = null
let pdfName = 'output'
let pdfjsDoc: pdfjsLib.PDFDocumentProxy | null = null
let pageIndex = 0
let pageCount = 0

let viewScale = 1
let displayW = 0
let displayH = 0

const images = new Map<number, StoredImage>()
let placements: Placement[] = []
let selectedId: number | null = null
let drag: Drag | null = null
let nextId = 1

// --- 状態表示 ---

function setStatus(text: string) {
  statusLine.textContent = text
}

// --- 正規化層 ---
// どの入口から来た画像も必ずここを通す。
// 出口の形: EXIF適用済み・長辺3000px以下・透過の有無が判明したビットマップ

async function normalizeImage(blob: Blob): Promise<StoredImage | null> {
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    setStatus(`未対応の形式です (${blob.type || '不明'})。PNG と JPEG のみ対応しています`)
    return null
  }

  // from-image でブラウザが EXIF の向きを適用したビットマップを返す
  let src: ImageBitmap
  try {
    src = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    setStatus('画像を読み込めませんでした')
    return null
  }

  // 長辺が上限を超えていたら縮める
  const longEdge = Math.max(src.width, src.height)
  const scale = longEdge > LOAD_MAX_EDGE ? LOAD_MAX_EDGE / longEdge : 1
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))

  // canvas に描き直した時点で EXIF の回転がピクセルに焼き込まれる
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.drawImage(src, 0, 0, w, h)
  src.close()

  // JPEG に透過はないので, PNG のときだけ調べる
  let hasAlpha = false
  if (blob.type === 'image/png') {
    const d = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 255) { hasAlpha = true; break }
    }
  }

  const bitmap = await createImageBitmap(cv)

  const img: StoredImage = { id: nextId++, bitmap, hasAlpha }
  images.set(img.id, img)
  return img
}

// canvas を Blob にする。toBlob はコールバックなので Promise で包む
function canvasToBlob(cv: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

// 書き出し用に, 指定した横幅でエンコードし直す
async function encodeForExport(img: StoredImage, targetW: number) {
  const w = Math.max(1, Math.min(img.bitmap.width, Math.round(targetW)))
  const h = Math.max(1, Math.round(img.bitmap.height * (w / img.bitmap.width)))

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.drawImage(img.bitmap, 0, 0, w, h)

  // 透過があるなら PNG, なければ JPEG。写真を PNG で持つとファイルが肥大する
  const mime = img.hasAlpha ? 'image/png' : 'image/jpeg'
  const blob = await canvasToBlob(cv, mime, img.hasAlpha ? undefined : JPEG_QUALITY)
  return { bytes: await blob.arrayBuffer(), mime }
}

// --- 配置を作る ---

function addPlacement(img: StoredImage) {
  // 初期配置: ページ幅の50%, 中央。収まらなければ縮める
  let dw = displayW * 0.5
  let dh = dw * (img.bitmap.height / img.bitmap.width)
  if (dh > displayH * 0.9) {
    dh = displayH * 0.9
    dw = dh * (img.bitmap.width / img.bitmap.height)
  }

  const p: Placement = {
    id: nextId++,
    imageId: img.id,
    pageIndex,
    dx: (displayW - dw) / 2,
    dy: (displayH - dh) / 2,
    dw, dh,
  }
  placements.push(p)
  selectedId = p.id
  drawOverlay()
}

async function acceptImage(blob: Blob) {
  if (!pdfjsDoc) {
    setStatus('先に PDF を選んでください')
    return
  }
  const img = await normalizeImage(blob)
  if (!img) return
  addPlacement(img)
  setStatus(`画像を追加しました (${img.bitmap.width} x ${img.bitmap.height}${img.hasAlpha ? ', 透過あり' : ''})`)
}

// --- 座標変換 (Step 0 で確定) ---

function placementToPdf(p: Placement, crop: Box, rotation: number) {
  const { x: cx, y: cy, width: cw, height: ch } = crop
  switch (rotation) {
    case 90:  return { x: cx + p.dy + p.dh,      y: cy + p.dx,           rotate: 90 }
    case 180: return { x: cx + cw - p.dx,        y: cy + p.dy + p.dh,    rotate: 180 }
    case 270: return { x: cx + cw - p.dy - p.dh, y: cy + ch - p.dx,      rotate: 270 }
    default:  return { x: cx + p.dx,             y: cy + ch - p.dy - p.dh, rotate: 0 }
  }
}

function normalizeRotation(angle: number) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

// --- マウス座標 -> 表示pt ---

function toDisplayPt(ev: MouseEvent) {
  const rect = overlay.getBoundingClientRect()
  const px = (ev.clientX - rect.left) * (overlay.width / rect.width)
  const py = (ev.clientY - rect.top) * (overlay.height / rect.height)
  return { x: px / viewScale, y: py / viewScale }
}

// --- 当たり判定 ---

function cornersOf(p: Placement) {
  return {
    nw: { x: p.dx,        y: p.dy },
    ne: { x: p.dx + p.dw, y: p.dy },
    sw: { x: p.dx,        y: p.dy + p.dh },
    se: { x: p.dx + p.dw, y: p.dy + p.dh },
  }
}

function hitCorner(p: Placement, x: number, y: number): Corner | null {
  const r = (HANDLE_PX / viewScale) * 0.75
  const cs = cornersOf(p)
  for (const key of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
    const c = cs[key]
    if (Math.abs(x - c.x) <= r && Math.abs(y - c.y) <= r) return key
  }
  return null
}

function hitBody(p: Placement, x: number, y: number) {
  return x >= p.dx && x <= p.dx + p.dw && y >= p.dy && y <= p.dy + p.dh
}

function pagePlacements() {
  return placements.filter(p => p.pageIndex === pageIndex)
}

// --- 描画 ---

function drawOverlay() {
  const ctx = overlay.getContext('2d')!
  ctx.clearRect(0, 0, overlay.width, overlay.height)

  for (const p of pagePlacements()) {
    const img = images.get(p.imageId)
    if (!img) continue

    ctx.drawImage(img.bitmap, p.dx * viewScale, p.dy * viewScale, p.dw * viewScale, p.dh * viewScale)

    if (p.id === selectedId) {
      ctx.strokeStyle = '#1a73e8'
      ctx.lineWidth = 1.5
      ctx.strokeRect(p.dx * viewScale, p.dy * viewScale, p.dw * viewScale, p.dh * viewScale)

      const cs = cornersOf(p)
      ctx.fillStyle = '#ffffff'
      for (const key of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
        const c = cs[key]
        const hx = c.x * viewScale - HANDLE_PX / 2
        const hy = c.y * viewScale - HANDLE_PX / 2
        ctx.fillRect(hx, hy, HANDLE_PX, HANDLE_PX)
        ctx.strokeRect(hx, hy, HANDLE_PX, HANDLE_PX)
      }
    }
  }
}

async function renderPage() {
  if (!pdfjsDoc) return

  const page = await pdfjsDoc.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  viewScale = TARGET_WIDTH / base.width
  const viewport = page.getViewport({ scale: viewScale })

  displayW = base.width
  displayH = base.height

  const w = Math.floor(viewport.width)
  const h = Math.floor(viewport.height)
  pageCanvas.width = w
  pageCanvas.height = h
  overlay.width = w
  overlay.height = h

  const ctx = pageCanvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  await page.render({ canvas: pageCanvas, canvasContext: ctx, viewport }).promise

  pageLabel.textContent = `${pageIndex + 1} / ${pageCount}`
  drawOverlay()
}

// --- PDF 読み込み ---

pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files?.[0]
  if (!file) return

  pdfData = await file.arrayBuffer()
  pdfName = file.name.replace(/\.pdf$/i, '')
  pdfjsDoc = await pdfjsLib.getDocument({ data: pdfData.slice(0) }).promise

  pageCount = pdfjsDoc.numPages
  pageIndex = 0
  placements = []
  images.clear()
  selectedId = null
  await renderPage()
  setStatus(`${file.name} を開きました (${pageCount} ページ)`)
})

// --- 画像の入口 ---

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0]
  if (!file) return
  await acceptImage(file)
  imageInput.value = ''   // 同じファイルを続けて選べるように
})

window.addEventListener('paste', async ev => {
  const items = ev.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob) {
        ev.preventDefault()
        await acceptImage(blob)
      }
      return
    }
  }
})

// --- マウス操作 ---

overlay.addEventListener('mousedown', ev => {
  const { x, y } = toDisplayPt(ev)
  const list = pagePlacements()

  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]

    if (p.id === selectedId) {
      const corner = hitCorner(p, x, y)
      if (corner) {
        const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }
        const a = cornersOf(p)[opposite[corner]]
        drag = { kind: 'resize', id: p.id, corner, anchorX: a.x, anchorY: a.y, aspect: p.dw / p.dh }
        return
      }
    }

    if (hitBody(p, x, y)) {
      selectedId = p.id
      drag = { kind: 'move', id: p.id, grabDx: x - p.dx, grabDy: y - p.dy }
      drawOverlay()
      return
    }
  }

  selectedId = null
  drag = null
  drawOverlay()
})

window.addEventListener('mousemove', ev => {
  if (!drag) { updateCursor(ev); return }

  const { x, y } = toDisplayPt(ev)
  const p = placements.find(q => q.id === drag!.id)
  if (!p) return

  if (drag.kind === 'move') {
    p.dx = x - drag.grabDx
    p.dy = y - drag.grabDy
  } else {
    const rawW = Math.abs(x - drag.anchorX)
    const rawH = Math.abs(y - drag.anchorY)

    let w: number, h: number
    if (rawW / drag.aspect >= rawH) { w = rawW; h = rawW / drag.aspect }
    else                            { h = rawH; w = rawH * drag.aspect }
    w = Math.max(w, MIN_PT)
    h = Math.max(h, MIN_PT / drag.aspect)

    p.dw = w
    p.dh = h
    p.dx = drag.corner === 'nw' || drag.corner === 'sw' ? drag.anchorX - w : drag.anchorX
    p.dy = drag.corner === 'nw' || drag.corner === 'ne' ? drag.anchorY - h : drag.anchorY
  }

  drawOverlay()
})

window.addEventListener('mouseup', () => { drag = null })

function updateCursor(ev: MouseEvent) {
  const rect = overlay.getBoundingClientRect()
  if (ev.clientX < rect.left || ev.clientX > rect.right ||
      ev.clientY < rect.top  || ev.clientY > rect.bottom) return

  const { x, y } = toDisplayPt(ev)
  const sel = placements.find(p => p.id === selectedId && p.pageIndex === pageIndex)

  if (sel) {
    const corner = hitCorner(sel, x, y)
    if (corner === 'nw' || corner === 'se') { overlay.style.cursor = 'nwse-resize'; return }
    if (corner === 'ne' || corner === 'sw') { overlay.style.cursor = 'nesw-resize'; return }
  }
  overlay.style.cursor = pagePlacements().some(p => hitBody(p, x, y)) ? 'move' : 'default'
}

// --- キーボード ---

window.addEventListener('keydown', ev => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return
  if (selectedId === null) return

  const p = placements.find(q => q.id === selectedId)
  if (!p) return

  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    removeSelected()
    ev.preventDefault()
    return
  }

  const step = ev.shiftKey ? 10 : 1
  let moved = true
  switch (ev.key) {
    case 'ArrowLeft':  p.dx -= step; break
    case 'ArrowRight': p.dx += step; break
    case 'ArrowUp':    p.dy -= step; break
    case 'ArrowDown':  p.dy += step; break
    default: moved = false
  }
  if (moved) { drawOverlay(); ev.preventDefault() }
})

function removeSelected() {
  if (selectedId === null) return
  placements = placements.filter(p => p.id !== selectedId)
  selectedId = null
  drawOverlay()
  setStatus('削除しました')
}

deleteButton.addEventListener('click', removeSelected)

// --- ページ送り ---

prevButton.addEventListener('click', async () => {
  if (pageIndex <= 0) return
  pageIndex--
  selectedId = null
  await renderPage()
})

nextButton.addEventListener('click', async () => {
  if (pageIndex >= pageCount - 1) return
  pageIndex++
  selectedId = null
  await renderPage()
})

// --- 書き出し ---

exportButton.addEventListener('click', async () => {
  if (!pdfData) { setStatus('PDF が選択されていません'); return }
  if (placements.length === 0) { setStatus('貼り付けた画像がありません'); return }

  exportButton.disabled = true
  setStatus('書き出し中...')
  const t0 = performance.now()

  try {
    const pdfDoc = await PDFDocument.load(pdfData)

    // 同じ画像は1回だけ埋め込む。
    // 配置サイズが複数あるときは, 一番大きいものに合わせて解像度を決める
    const maxWidthPerImage = new Map<number, number>()
    for (const p of placements) {
      const cur = maxWidthPerImage.get(p.imageId) ?? 0
      if (p.dw > cur) maxWidthPerImage.set(p.imageId, p.dw)
    }

    const embedded = new Map<number, Awaited<ReturnType<typeof pdfDoc.embedPng>>>()
    for (const [imageId, maxDw] of maxWidthPerImage) {
      const img = images.get(imageId)
      if (!img) continue
      const targetPx = (maxDw / 72) * EXPORT_DPI
      const { bytes, mime } = await encodeForExport(img, targetPx)
      embedded.set(
        imageId,
        mime === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes),
      )
    }

    for (const p of placements) {
      const emb = embedded.get(p.imageId)
      if (!emb) continue

      const page = pdfDoc.getPage(p.pageIndex)
      const crop = page.getCropBox()
      const rotation = normalizeRotation(page.getRotation().angle)
      const anchor = placementToPdf(p, crop, rotation)

      page.drawImage(emb, {
        x: anchor.x,
        y: anchor.y,
        width: p.dw,
        height: p.dh,
        rotate: degrees(anchor.rotate),
      })
    }

    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `out-${pdfName}.pdf`
    a.click()
    URL.revokeObjectURL(url)

    const ms = Math.round(performance.now() - t0)
    const mb = (blob.size / 1024 / 1024).toFixed(2)
    setStatus(`書き出しました (画像 ${placements.length} 枚 / ${mb} MB / ${ms} ms)`)
  } catch (e) {
    setStatus('書き出しに失敗しました: ' + String(e))
  } finally {
    exportButton.disabled = false
  }
})

setStatus('PDF を選んでください')