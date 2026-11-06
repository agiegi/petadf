// 画像の正規化層。
// どの入口から来た画像も必ずここを通す。
// 出口の形: EXIF適用済み・長辺3000px以下・透過の有無が判明したビットマップ
import { JPEG_QUALITY, LOAD_MAX_EDGE, THUMB_PX } from './constants'
import { newId, S } from './state'
import { setStatus } from './status'
import type { StoredImage } from './types'

export async function normalizeImage(blob: Blob): Promise<StoredImage | null> {
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
  const tScale = Math.min(THUMB_PX / w, THUMB_PX / h)
  tcv.width = Math.max(1, Math.round(w * tScale))
  tcv.height = Math.max(1, Math.round(h * tScale))
  tcv.getContext('2d')!.drawImage(bitmap, 0, 0, tcv.width, tcv.height)

  const img: StoredImage = { id: newId(), bitmap, hasAlpha, thumbUrl: tcv.toDataURL('image/png') }
  S.images.set(img.id, img)
  return img
}

function canvasToBlob(cv: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

export async function encodeForExport(img: StoredImage, targetW: number) {
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
