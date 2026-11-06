// 実測で決めた値が多い。変えるときは実機で確かめる

// 指で操作する端末ではハンドルを大きく描く。マウスなら従来どおり
export const COARSE_POINTER = matchMedia('(pointer: coarse)').matches
export const HANDLE_PX = COARSE_POINTER ? 16 : 10   // リサイズハンドルの辺 (CSS px)
export const TOUCH_GRAB_PX = 24      // 指で角をつかむときの当たり判定の半径 (CSS px)
export const MIN_PT = 20             // 画像の最小サイズ (pt)
export const LOAD_MAX_EDGE = 3000    // 読み込み時の長辺上限 (px)
export const EXPORT_DPI = 300        // 書き出し時の解像度
export const JPEG_QUALITY = 0.85
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3]   // 1 = 全体が収まる状態
export const FIT_INDEX = 2
export const AREA_PAD = 56           // #sheetArea の padding 相当
export const PT_TO_MM = 25.4 / 72
export const A4_PT = { w: 595.28, h: 841.89 }   // 何も開いていないときに作る白紙の大きさ
export const MAX_RENDER_SCALE = 4    // 表示pt -> 実ピクセル の上限。メモリの歯止め
export const THUMB_PX = 72           // 棚のサムネイルの長辺
