// アプリ全体で使う型。ここは値を持たない

export type Box = { x: number; y: number; width: number; height: number }

export type StoredImage = {
  id: number
  bitmap: ImageBitmap     // EXIF適用済み, 縮小済み
  hasAlpha: boolean
  thumbUrl: string
}

// ページは「元PDFのページ」か「追加した白紙」のどちらか。
// 表示も書き出しも sheets の並び順で行うので, sheets の添字がそのまま
// 書き出し後のページ番号になる。ページ番号で持つと挿入のたびにズレる
export type Sheet =
  | { kind: 'src'; srcIndex: number }
  | { kind: 'blank'; width: number; height: number }   // 表示pt (回転を適用した見た目の寸法)

export type Placement = {
  id: number
  imageId: number
  sheetIndex: number      // sheets の添字。元PDFのページ番号ではない
  dx: number; dy: number; dw: number; dh: number   // 表示pt, 左上原点
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

export type Drag =
  | { kind: 'move'; id: number; grabDx: number; grabDy: number }
  | { kind: 'resize'; id: number; corner: Corner; anchorX: number; anchorY: number; aspect: number }
  // 何も掴まなかったときは紙送り。touch-action を切った分を自前で埋める
  | { kind: 'pan'; startX: number; startY: number; scrollX: number; scrollY: number }
