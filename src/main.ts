// 入口。各モジュールを DOM のイベントに繋ぐだけで, 処理そのものは持たない
import './compat'      // pdfjs より先に読む。import は書いた順に実行される
import './pdfjs'       // worker の場所を設定する。compat より後であること
import './style.css'

import { attachAbout } from './about'
import { acceptImage, acceptPdf } from './doc'
import {
  addBlankButton, dropBlankButton, dropHint, exportButton, imageInput, nextButton,
  pageNo, pdfInput, peelButton, pileList, prevButton, zoomFit, zoomIn, zoomOut,
} from './dom'
import { exportPdf } from './export'
import { attachKeys } from './keys'
import { idFromEvent } from './list'
import { gotoPage, setZoom, zoomToFit } from './nav'
import { attachPointer } from './pointer'
import { renderPage, syncControls } from './render'
import { peelPlacement, peelSelected, pickPlacement } from './select'
import { addBlank, dropBlank } from './sheets'
import { pageCount, S } from './state'
import { setStatus } from './status'

// --- ファイルを受け取る ---

// value を戻すのは await の後。
// File を取り出してから input を空にする端末があるので, 順番を変えない
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

// --- 棚 ---
// 項目ごとにリスナを張らず, ここで1つだけ受けて data-id で引く。
// 作り直しのたびにクロージャを張り替えなくて済む

pileList.addEventListener('click', ev => {
  const hit = idFromEvent(ev.target as HTMLElement)
  if (!hit) return
  if (hit.role === 'peel') peelPlacement(hit.id)
  else void pickPlacement(hit.id)
})

// --- ツールバー ---

prevButton.addEventListener('click', () => void gotoPage(S.pageIndex - 1))
nextButton.addEventListener('click', () => void gotoPage(S.pageIndex + 1))

pageNo.addEventListener('change', () => {
  const n = parseInt(pageNo.value, 10)
  if (Number.isNaN(n)) { syncControls(); return }
  void gotoPage(n - 1)
})

zoomIn.addEventListener('click', () => void setZoom(S.zoomIdx + 1))
zoomOut.addEventListener('click', () => void setZoom(S.zoomIdx - 1))
zoomFit.addEventListener('click', () => void zoomToFit())

addBlankButton.addEventListener('click', () => void addBlank())
dropBlankButton.addEventListener('click', () => void dropBlank())
peelButton.addEventListener('click', peelSelected)
exportButton.addEventListener('click', () => void exportPdf())

// ウィンドウの大きさが変わると収まる倍率も変わる。
// 別のモニタへ移して devicePixelRatio が変わったときもここで描き直る
let resizeTimer = 0
window.addEventListener('resize', () => {
  if (pageCount() === 0) return
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => { void renderPage() }, 150)
})

// --- 組み立て ---

attachPointer()
attachKeys()
attachAbout()

syncControls()
setStatus('')
