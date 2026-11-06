// 文書を開く・始める・画像を受け取る。
// 状態の入れ替えは必ず startDocument を通す
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { A4_PT, FIT_INDEX } from './constants'
import { stage } from './dom'
import { normalizeImage } from './image'
import { pdfjsLib } from './pdfjs'
import { redraw, renderPage } from './render'
import { clearImages, newId, pageCount, S } from './state'
import { setStatus } from './status'
import type { Placement, Sheet, StoredImage } from './types'

type NewDocument = {
  sheets: Sheet[]
  data: ArrayBuffer | null
  doc: PDFDocumentProxy | null
  name: string
}

// 新しい文書に入れ替える。
// PDFを開いたときと白紙から始めたときで共通。片方に足して片方に足し忘れると,
// 前の文書の画像が棚に残ったりメモリが浮いたりする
export async function startDocument(next: NewDocument) {
  const old = S.pdfjsDoc

  clearImages()            // 参照を捨てる前に ImageBitmap を閉じる
  S.placements = []
  S.selectedId = null
  S.drag = null
  S.pageIndex = 0
  S.zoomIdx = FIT_INDEX
  S.sheets = next.sheets
  S.pdfData = next.data
  S.pdfjsDoc = next.doc
  S.pdfName = next.name

  await renderPage()

  // 前の文書を worker 側ごと解放する。renderPage が進行中の描画を
  // 先に止めているので, ここで捨てて安全。
  // destroy() を持つのは PDFDocumentProxy ではなく loadingTask のほう
  if (old && old !== S.pdfjsDoc) void old.loadingTask.destroy().catch(() => {})
}

export async function acceptPdf(file: File) {
  setStatus(`${file.name} を読み込んでいます`)

  // 先にローカル変数へ組み立てて, 成功してから状態に移す。
  // 途中で失敗したまま pdfData だけ差し替わると,
  // 「新しいバイト列 + 古いページ構成」という噛み合わない状態が残る
  let data: ArrayBuffer
  let doc: PDFDocumentProxy
  try {
    data = await file.arrayBuffer()
    // pdf.js は渡した ArrayBuffer を無効化するのでコピーを渡す
    doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise
  } catch (e) {
    const why = (e as Error)?.name === 'PasswordException'
      ? 'パスワードで保護されています'
      : 'PDF として読めませんでした'
    setStatus(`${file.name} を開けません (${why})`)
    return
  }

  // 最初は元PDFのページがそのまま並んでいる状態
  const sheets = Array.from(
    { length: doc.numPages },
    (_, i): Sheet => ({ kind: 'src', srcIndex: i }),
  )

  await startDocument({ sheets, data, doc, name: file.name.replace(/\.pdf$/i, '') })
  setStatus(`${file.name} を開きました (${pageCount()} ページ)。画像を貼ってください`)
}

// 何も開いていないところから白紙1枚で始める。
// 画像だけをPDFにしたいとき, 元のPDFが無いことがある
export async function startBlankDocument() {
  await startDocument({
    sheets: [{ kind: 'blank', width: A4_PT.w, height: A4_PT.h }],
    data: null,
    doc: null,
    name: 'petadf',
  })
  setStatus('白紙から始めます。画像を貼ってください')
}

function addPlacement(img: StoredImage) {
  // 初期配置: ページ幅の50%, 中央。収まらなければ縮める
  let dw = S.displayW * 0.5
  let dh = dw * (img.bitmap.height / img.bitmap.width)
  if (dh > S.displayH * 0.9) {
    dh = S.displayH * 0.9
    dw = dh * (img.bitmap.width / img.bitmap.height)
  }

  const p: Placement = {
    id: newId(),
    imageId: img.id,
    sheetIndex: S.pageIndex,
    dx: (S.displayW - dw) / 2,
    dy: (S.displayH - dh) / 2,
    dw, dh,
  }
  S.placements.push(p)
  S.selectedId = p.id
  redraw()
}

export async function acceptImage(blob: Blob) {
  if (pageCount() === 0) {
    setStatus('先に PDF を開くか,「白紙を追加」で始めてください')
    return
  }
  const img = await normalizeImage(blob)
  if (!img) return
  addPlacement(img)

  // ファイル選択の直後はフォーカスが input に残っていて,
  // キーボード処理のガード (input なら無視) に矢印キーが弾かれる。
  // 貼った直後から矢印で動かせるように作業面へ移す
  stage.focus({ preventScroll: true })

  setStatus(`画像を貼りました。ドラッグか矢印キーで位置を調整できます${img.hasAlpha ? ' (透過あり)' : ''}`)
}
