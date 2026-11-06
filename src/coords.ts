// 座標変換。4つのテスト用PDFと色分けした四角で実測して確定させた部分。
//
// ここを独立したファイルにしてあるのは, 触らないため。
// 引数だけで決まる純関数なので, ブラウザもPDFも無しに検証できる。
//
// 噛み合っている罠:
//   1. PDFの原点は左下, 画面は左上
//   2. getSize() は MediaBox を返すが, 実際に描画されるのは CropBox。
//      呼び出し側は必ず getCropBox() を渡すこと
//   3. /Rotate は pdf.js が適用するが pdf-lib は適用しない
//
// 関連する添字の罠 (このファイルの外):
//   - pdf.js は 1始まり, pdf-lib は 0始まり
//   - pdf.js は渡した ArrayBuffer を無効化する -> slice(0) を渡す
//   - 白紙を差し込むのは前から順。後ろから入れると前方の白紙の分だけずれる

import type { Box, Corner, Placement } from './types'

export function placementToPdf(p: Placement, crop: Box, rotation: number) {
  const { x: cx, y: cy, width: cw, height: ch } = crop
  switch (rotation) {
    case 90:  return { x: cx + p.dy + p.dh,      y: cy + p.dx,             rotate: 90 }
    case 180: return { x: cx + cw - p.dx,        y: cy + p.dy + p.dh,      rotate: 180 }
    case 270: return { x: cx + cw - p.dy - p.dh, y: cy + ch - p.dx,        rotate: 270 }
    default:  return { x: cx + p.dx,             y: cy + ch - p.dy - p.dh, rotate: 0 }
  }
}

export function normalizeRotation(angle: number) {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

export const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

export const OPPOSITE: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }

export function cornersOf(p: Placement) {
  return {
    nw: { x: p.dx,        y: p.dy },
    ne: { x: p.dx + p.dw, y: p.dy },
    sw: { x: p.dx,        y: p.dy + p.dh },
    se: { x: p.dx + p.dw, y: p.dy + p.dh },
  }
}
