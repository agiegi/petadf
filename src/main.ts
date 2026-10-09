import monUrl from './oh-gy-mon.png?url'
import pdfjsLicense from '../node_modules/pdfjs-dist/LICENSE?raw'
import pdflibLicense from '../node_modules/pdf-lib/LICENSE.md?raw'
import { PDFDocument, degrees } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const pdfInput = el<HTMLInputElement>('pdfInput')
const imageInput = el<HTMLInputElement>('imageInput')
const prevButton = el<HTMLButtonElement>('prevButton')
const nextButton = el<HTMLButtonElement>('nextButton')
const pageNo = el<HTMLInputElement>('pageNo')
const pageTotal = el<HTMLSpanElement>('pageTotal')
const zoomIn = el<HTMLButtonElement>('zoomIn')
const zoomOut = el<HTMLButtonElement>('zoomOut')
const zoomFit = el<HTMLButtonElement>('zoomFit')
const zoomNow = el<HTMLSpanElement>('zoomNow')
const peelButton = el<HTMLButtonElement>('peelButton')
const exportButton = el<HTMLButtonElement>('exportButton')
const statusLine = el<HTMLParagraphElement>('status')
const sheetArea = el<HTMLDivElement>('sheetArea')
const stage = el<HTMLDivElement>('stage')
const emptyState = el<HTMLDivElement>('emptyState')
const dropHint = el<HTMLDivElement>('dropHint')
const pageCanvas = el<HTMLCanvasElement>('pageCanvas')
const overlay = el<HTMLCanvasElement>('overlayCanvas')
const pileList = el<HTMLUListElement>('pileList')
const pileEmpty = el<HTMLParagraphElement>('pileEmpty')
const pileCount = el<HTMLSpanElement>('pileCount')

// --- 定数 ---

const HANDLE_PX = 10        // リサイズハンドルの辺 (px)
const MIN_PT = 20           // 画像の最小サイズ (pt)
const LOAD_MAX_EDGE = 3000  // 読み込み時の長辺上限 (px)
const EXPORT_DPI = 200      // 書き出し時の解像度
const JPEG_QUALITY = 0.85
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3]   // 1 = 全体が収まる状態
const FIT_INDEX = 2
const AREA_PAD = 56         // #sheetArea の padding 相当
const PT_TO_MM = 25.4 / 72

// --- 型 ---

type Box = { x: number; y: number; width: number; height: number }

type StoredImage = {
  id: number
  bitmap: ImageBitmap     // EXIF適用済み, 縮小済み
  hasAlpha: boolean
  thumbUrl: string
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

let zoomIdx = FIT_INDEX
let viewScale = 1
let displayW = 0
let displayH = 0

const images = new Map<number, StoredImage>()
let placements: Placement[] = []
let selectedId: number | null = null
let drag: Drag | null = null
let nextId = 1

// --- 状態表示 ---
// #status は role="status" aria-live="polite"。書き換えるだけで読み上げられる

function setStatus(text: string) {
  statusLine.textContent = text
}

// --- 正規化層 ---
// どの入口から来た画像も必ずここを通す。
// 出口の形: EXIF適用済み・長辺3000px以下・透過の有無が判明したビットマップ

async function normalizeImage(blob: Blob): Promise<StoredImage | null> {
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    setStatus(`${blob.type || 'この形式'} には対応していません。PNG か JPEG を選んでください`)
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

  // 棚に出すサムネイル
  const tcv = document.createElement('canvas')
  const tScale = Math.min(72 / w, 72 / h)
  tcv.width = Math.max(1, Math.round(w * tScale))
  tcv.height = Math.max(1, Math.round(h * tScale))
  tcv.getContext('2d')!.drawImage(bitmap, 0, 0, tcv.width, tcv.height)

  const img: StoredImage = { id: nextId++, bitmap, hasAlpha, thumbUrl: tcv.toDataURL('image/png') }
  images.set(img.id, img)
  return img
}

function canvasToBlob(cv: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

async function encodeForExport(img: StoredImage, targetW: number) {
  const w = Math.max(1, Math.min(img.bitmap.width, Math.round(targetW)))
  const h = Math.max(1, Math.round(img.bitmap.height * (w / img.bitmap.width)))

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  cv.getContext('2d')!.drawImage(img.bitmap, 0, 0, w, h)

  // 透過があるなら PNG, なければ JPEG。写真を PNG で持つとファイルが肥大する
  const mime = img.hasAlpha ? 'image/png' : 'image/jpeg'
  const blob = await canvasToBlob(cv, mime, img.hasAlpha ? undefined : JPEG_QUALITY)
  return { bytes: await blob.arrayBuffer(), mime }
}

// --- 配置 ---

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
  redraw()
}

async function acceptImage(blob: Blob) {
  if (!pdfjsDoc) {
    setStatus('先に PDF を開いてください')
    return
  }
  const img = await normalizeImage(blob)
  if (!img) return
  addPlacement(img)
  setStatus(`画像を貼りました。ドラッグか矢印キーで位置を調整できます${img.hasAlpha ? ' (透過あり)' : ''}`)
}

// --- 座標変換 (Step 0 で確定。触らない) ---

function placementToPdf(p: Placement, crop: Box, rotation: number) {
  const { x: cx, y: cy, width: cw, height: ch } = crop
  switch (rotation) {
    case 90:  return { x: cx + p.dy + p.dh,      y: cy + p.dx,             rotate: 90 }
    case 180: return { x: cx + cw - p.dx,        y: cy + p.dy + p.dh,      rotate: 180 }
    case 270: return { x: cx + cw - p.dy - p.dh, y: cy + ch - p.dx,        rotate: 270 }
    default:  return { x: cx + p.dx,             y: cy + ch - p.dy - p.dh, rotate: 0 }
  }
}

function normalizeRotation(angle: number) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

// 表示領域に収まる倍率。倍率100% = ページ全体が見える状態
function fitScale(pw: number, ph: number) {
  const r = sheetArea.getBoundingClientRect()
  const w = Math.max(200, r.width - AREA_PAD)
  const h = Math.max(200, r.height - AREA_PAD)
  return Math.max(0.1, Math.min(w / pw, h / ph))
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
  const r = (HANDLE_PX / viewScale) * 0.8
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

function selected() {
  return placements.find(p => p.id === selectedId) ?? null
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
      // 白と青の二重線。下の紙が明るくても画像が暗くても枠が見える
      const x = p.dx * viewScale, y = p.dy * viewScale
      const w = p.dw * viewScale, h = p.dh * viewScale

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.strokeRect(x, y, w, h)
      ctx.strokeStyle = '#1b5fbf'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x, y, w, h)

      const cs = cornersOf(p)
      for (const key of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
        const c = cs[key]
        const hx = c.x * viewScale - HANDLE_PX / 2
        const hy = c.y * viewScale - HANDLE_PX / 2
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(hx, hy, HANDLE_PX, HANDLE_PX)
        ctx.strokeStyle = '#1b5fbf'
        ctx.lineWidth = 1.5
        ctx.strokeRect(hx, hy, HANDLE_PX, HANDLE_PX)
      }
    }
  }
}

// 棚。canvas の中身は支援技術から見えないので, ここが代替表現になる
function drawList() {
  pileList.textContent = ''
  pileEmpty.hidden = placements.length > 0
  pileCount.textContent = placements.length > 0 ? String(placements.length) : ''

  placements.forEach((p, i) => {
    const img = images.get(p.imageId)
    const li = document.createElement('li')

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'pile'
    btn.setAttribute('aria-pressed', String(p.id === selectedId))

    const thumb = document.createElement('img')
    thumb.alt = ''
    if (img) thumb.src = img.thumbUrl

    const lines = document.createElement('span')
    lines.className = 'lines'
    const name = document.createElement('span')
    name.textContent = `画像 ${i + 1}`
    const size = document.createElement('span')
    size.className = 'size'
    size.textContent =
      `${p.pageIndex + 1}ページ　${Math.round(p.dw * PT_TO_MM)}×${Math.round(p.dh * PT_TO_MM)}mm`
    lines.append(name, size)

    btn.append(thumb, lines)
    btn.addEventListener('click', async () => {
      selectedId = p.id
      if (p.pageIndex !== pageIndex) {
        pageIndex = p.pageIndex
        await renderPage()
      } else {
        redraw()
      }
      setStatus(`画像 ${i + 1} を選びました`)
    })

    const peel = document.createElement('button')
    peel.type = 'button'
    peel.className = 'peel'
    peel.textContent = '×'
    peel.setAttribute('aria-label', `画像 ${i + 1} をはがす`)
    peel.addEventListener('click', () => {
      placements = placements.filter(q => q.id !== p.id)
      if (selectedId === p.id) selectedId = null
      redraw()
      setStatus(`画像 ${i + 1} をはがしました`)
    })

    li.append(btn, peel)
    pileList.append(li)
  })

  peelButton.disabled = selectedId === null
}

function redraw() {
  drawOverlay()
  drawList()
}

async function renderPage() {
  if (!pdfjsDoc) return

  const page = await pdfjsDoc.getPage(pageIndex + 1)   // pdf.js は1始まり
  const base = page.getViewport({ scale: 1 })

  viewScale = fitScale(base.width, base.height) * ZOOM_STEPS[zoomIdx]
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

  pageNo.value = String(pageIndex + 1)
  pageTotal.textContent = String(pageCount)
  prevButton.disabled = pageIndex <= 0
  nextButton.disabled = pageIndex >= pageCount - 1
  zoomNow.textContent = `${Math.round(ZOOM_STEPS[zoomIdx] * 100)}%`
  zoomOut.disabled = zoomIdx <= 0
  zoomIn.disabled = zoomIdx >= ZOOM_STEPS.length - 1

  redraw()
}

// --- PDF を開く ---

async function acceptPdf(file: File) {
  pdfData = await file.arrayBuffer()
  pdfName = file.name.replace(/\.pdf$/i, '')

  // pdf.js は渡した ArrayBuffer を無効化するのでコピーを渡す
  pdfjsDoc = await pdfjsLib.getDocument({ data: pdfData.slice(0) }).promise

  pageCount = pdfjsDoc.numPages
  pageIndex = 0
  zoomIdx = FIT_INDEX
  placements = []
  images.clear()
  selectedId = null

  emptyState.hidden = true
  stage.hidden = false
  pageNo.disabled = false
  pageNo.max = String(pageCount)
  zoomFit.disabled = false
  exportButton.disabled = false

  await renderPage()
  setStatus(`${file.name} を開きました (${pageCount} ページ)。画像を貼ってください`)
}

pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files?.[0]
  if (!file) return
  await acceptPdf(file)
  pdfInput.value = ''
})

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0]
  if (!file) return
  await acceptImage(file)
  imageInput.value = ''   // 同じファイルを続けて選べるように
})

// --- クリップボード ---

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

// --- ドラッグ&ドロップ ---
// dragenter/leave は子要素をまたぐたびに飛ぶので, 深さを数えないと表示がちらつく

let dragDepth = 0

window.addEventListener('dragenter', ev => {
  if (!ev.dataTransfer?.types.includes('Files')) return
  ev.preventDefault()
  dragDepth++
  dropHint.classList.add('on')
})

window.addEventListener('dragover', ev => {
  if (!ev.dataTransfer?.types.includes('Files')) return
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'copy'
})

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropHint.classList.remove('on')
})

window.addEventListener('drop', async ev => {
  const files = ev.dataTransfer?.files
  if (!files || files.length === 0) return
  ev.preventDefault()
  dragDepth = 0
  dropHint.classList.remove('on')

  for (const f of Array.from(files)) {
    if (f.type === 'application/pdf') { await acceptPdf(f); continue }
    if (f.type.startsWith('image/')) { await acceptImage(f); continue }
    setStatus(`${f.name} には対応していません`)
  }
})

// --- マウス操作 ---

overlay.addEventListener('mousedown', ev => {
  const { x, y } = toDisplayPt(ev)
  const list = pagePlacements()

  // 手前にあるものを優先するので後ろから見る
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
      redraw()
      return
    }
  }

  selectedId = null
  drag = null
  redraw()
})

// canvas に付けると, 速くドラッグして外へ出た瞬間に止まる。window に付ける
window.addEventListener('mousemove', ev => {
  if (!drag) { updateCursor(ev); return }

  const { x, y } = toDisplayPt(ev)
  const p = placements.find(q => q.id === drag!.id)
  if (!p) return

  if (drag.kind === 'move') {
    p.dx = x - drag.grabDx
    p.dy = y - drag.grabDy
  } else {
    // 対角のハンドルを固定したまま, 縦横比を保って拡縮
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

window.addEventListener('mouseup', () => {
  if (drag) { drag = null; drawList() }
})

function updateCursor(ev: MouseEvent) {
  const rect = overlay.getBoundingClientRect()
  if (ev.clientX < rect.left || ev.clientX > rect.right ||
      ev.clientY < rect.top  || ev.clientY > rect.bottom) return

  const { x, y } = toDisplayPt(ev)
  const sel = selected()

  if (sel && sel.pageIndex === pageIndex) {
    const corner = hitCorner(sel, x, y)
    if (corner === 'nw' || corner === 'se') { overlay.style.cursor = 'nwse-resize'; return }
    if (corner === 'ne' || corner === 'sw') { overlay.style.cursor = 'nesw-resize'; return }
  }
  overlay.style.cursor = pagePlacements().some(p => hitBody(p, x, y)) ? 'move' : 'default'
}

// --- キーボード ---
// マウスが使えなくても, 選択・移動・拡縮・はがすが全部できるようにする

function scaleSelected(factor: number) {
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

window.addEventListener('keydown', ev => {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return

  if (ev.key === 'Escape' && selectedId !== null) {
    selectedId = null
    redraw()
    setStatus('選択を外しました')
    return
  }

  const p = selected()
  if (!p) return

  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    peelSelected()
    ev.preventDefault()
    return
  }

  if (ev.key === '+' || ev.key === '=') { scaleSelected(1.05); ev.preventDefault(); return }
  if (ev.key === '-' || ev.key === '_') { scaleSelected(1 / 1.05); ev.preventDefault(); return }

  const step = ev.shiftKey ? 10 : 1
  let moved = true
  switch (ev.key) {
    case 'ArrowLeft':  p.dx -= step; break
    case 'ArrowRight': p.dx += step; break
    case 'ArrowUp':    p.dy -= step; break
    case 'ArrowDown':  p.dy += step; break
    default: moved = false
  }
  if (moved) {
    redraw()
    setStatus(`位置 左から ${Math.round(p.dx * PT_TO_MM)} mm, 上から ${Math.round(p.dy * PT_TO_MM)} mm`)
    ev.preventDefault()
  }
})

function peelSelected() {
  if (selectedId === null) return
  placements = placements.filter(p => p.id !== selectedId)
  selectedId = null
  redraw()
  setStatus('はがしました')
}

peelButton.addEventListener('click', peelSelected)

// --- ページ送り ---

async function gotoPage(n: number) {
  const next = Math.min(Math.max(0, n), pageCount - 1)
  if (next === pageIndex) { pageNo.value = String(pageIndex + 1); return }
  pageIndex = next
  selectedId = null
  await renderPage()
  setStatus(`${pageIndex + 1} ページ目`)
}

prevButton.addEventListener('click', () => gotoPage(pageIndex - 1))
nextButton.addEventListener('click', () => gotoPage(pageIndex + 1))

pageNo.addEventListener('change', () => {
  const n = parseInt(pageNo.value, 10)
  if (Number.isNaN(n)) { pageNo.value = String(pageIndex + 1); return }
  gotoPage(n - 1)
})

// --- 拡大縮小 ---

async function setZoom(idx: number) {
  const next = Math.min(Math.max(0, idx), ZOOM_STEPS.length - 1)
  if (next === zoomIdx) return
  zoomIdx = next
  await renderPage()
  setStatus(`表示倍率 ${Math.round(ZOOM_STEPS[zoomIdx] * 100)}%`)
}

zoomIn.addEventListener('click', () => setZoom(zoomIdx + 1))
zoomOut.addEventListener('click', () => setZoom(zoomIdx - 1))
zoomFit.addEventListener('click', () => setZoom(FIT_INDEX))

// ウィンドウの大きさが変わると「収まる倍率」も変わるので描き直す
let resizeTimer = 0
window.addEventListener('resize', () => {
  if (!pdfjsDoc) return
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => { void renderPage() }, 150)
})

// --- 書き出し ---

exportButton.addEventListener('click', async () => {
  if (!pdfData) { setStatus('PDF が開かれていません'); return }
  if (placements.length === 0) { setStatus('貼った画像がありません'); return }

  exportButton.disabled = true
  setStatus('書き出しています')
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
    setStatus(`out-${pdfName}.pdf を書き出しました (画像 ${placements.length} 枚 / ${mb} MB / ${ms} ms)`)
  } catch (e) {
    setStatus('書き出しに失敗しました: ' + String(e))
  } finally {
    exportButton.disabled = false
  }
})

// --- このツールについて ---

const VERSION = '0.2.0'

const aboutButton = el<HTMLButtonElement>('aboutButton')
const aboutBackdrop = el<HTMLDivElement>('aboutBackdrop')
const aboutPanel = el<HTMLDivElement>('aboutPanel')
const aboutClose = el<HTMLButtonElement>('aboutClose')
const aboutMon = el<HTMLImageElement>('aboutMon')

aboutMon.src = monUrl
el<HTMLPreElement>('licPdfjs').textContent = pdfjsLicense
el<HTMLPreElement>('licPdflib').textContent = pdflibLicense
el<HTMLSpanElement>('aboutVersion').textContent = VERSION

let aboutOpen = false
let lastFocus: HTMLElement | null = null

function openAbout() {
  lastFocus = document.activeElement as HTMLElement
  aboutOpen = true
  aboutBackdrop.classList.add('open')
  aboutClose.focus()
}

function closeAbout() {
  aboutOpen = false
  aboutBackdrop.classList.remove('open')
  lastFocus?.focus()   // 開く前にいた場所へ戻す
}

aboutButton.addEventListener('click', openAbout)
aboutClose.addEventListener('click', closeAbout)

aboutBackdrop.addEventListener('click', ev => {
  if (ev.target === aboutBackdrop) closeAbout()
})

// 開いている間はフォーカスをパネルの中に閉じ込める。
// capture 段階で処理するので, 上のキーボード処理に手を入れなくて済む
window.addEventListener('keydown', ev => {
  if (!aboutOpen) return

  if (ev.key === 'Escape') { closeAbout(); ev.stopPropagation(); return }

  if (ev.key === 'Tab') {
    const focusable = aboutPanel.querySelectorAll<HTMLElement>(
      'button, [href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length > 0) {
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault() }
      else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault() }
    }
  }

  ev.stopPropagation()
}, true)

setStatus('')