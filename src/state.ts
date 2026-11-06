// アプリの状態。ここはデータだけを持ち, 描画もDOMも触らない。
// 他のモジュールは S を読み書きする
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { FIT_INDEX } from './constants'
import type { Drag, Placement, Sheet, StoredImage } from './types'

export const S = {
  pdfData: null as ArrayBuffer | null,
  pdfName: 'output',
  pdfjsDoc: null as PDFDocumentProxy | null,

  sheets: [] as Sheet[],
  pageIndex: 0,          // sheets の添字

  zoomIdx: FIT_INDEX,
  viewScale: 1,          // 表示pt -> CSS px
  pixelRatio: 1,         // CSS px -> canvas の実ピクセル
  displayW: 0,
  displayH: 0,

  images: new Map<number, StoredImage>(),
  placements: [] as Placement[],
  selectedId: null as number | null,
  drag: null as Drag | null,

  // 書き出し中。ツールバーの同期が走っても「書き出す」を押し戻さないための印
  exporting: false,
}

let idSeq = 0
export function newId() {
  return ++idSeq
}

// ページ数は sheets.length そのもの。別の変数で持つと挿入・削除のたびに
// 両方を直す必要が出て, 片方だけ忘れる
export function pageCount() {
  return S.sheets.length
}

export function currentSheet(): Sheet | undefined {
  return S.sheets[S.pageIndex]
}

export function pagePlacements() {
  return S.placements.filter(p => p.sheetIndex === S.pageIndex)
}

export function selected() {
  return S.placements.find(p => p.id === S.selectedId) ?? null
}

// ページの見た目の寸法 (表示pt)。
// pdf.js の viewport は CropBox と /Rotate を適用済みなので, そのまま使える
export async function sheetSize(i: number): Promise<{ w: number; h: number }> {
  const s = S.sheets[i]
  if (s.kind === 'blank') return { w: s.width, h: s.height }
  const page = await S.pdfjsDoc!.getPage(s.srcIndex + 1)      // pdf.js は1始まり
  const base = page.getViewport({ scale: 1 })
  return { w: base.width, h: base.height }
}

// ImageBitmap はネイティブ側のメモリを持つので, 参照を捨てるだけでは足りない。
// 長辺3000pxなら1枚で約27MB。iOS はタブのメモリ上限が厳しく, 溜めると落ちる
export function releaseImage(id: number) {
  S.images.get(id)?.bitmap.close()
  S.images.delete(id)
}

export function clearImages() {
  for (const img of S.images.values()) img.bitmap.close()
  S.images.clear()
}

// どの配置からも参照されなくなった画像を解放する。
// いまは画像と配置が1対1だが, 複製を作れるようにしたらここが効く
export function releaseUnusedImages() {
  const used = new Set(S.placements.map(p => p.imageId))
  for (const id of [...S.images.keys()]) {
    if (!used.has(id)) releaseImage(id)
  }
}
