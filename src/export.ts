// 書き出し。ここで初めて元PDFのバイト列を読み, 新しいPDFを組む
import { degrees, PDFDocument } from 'pdf-lib'
import { EXPORT_DPI } from './constants'
import { normalizeRotation, placementToPdf } from './coords'
import { encodeForExport } from './image'
import { syncControls } from './render'
import { pageCount, S } from './state'
import { setStatus } from './status'

export async function exportPdf() {
  if (pageCount() === 0) {
    setStatus('まだ何も開かれていません')
    return
  }

  const blankCount = S.sheets.filter(s => s.kind === 'blank').length
  if (S.placements.length === 0 && blankCount === 0) {
    setStatus('貼った画像がありません')
    return
  }

  S.exporting = true
  syncControls()
  setStatus('書き出しています')
  const t0 = performance.now()

  try {
    // 元PDFがあればその上に, 無ければ空のPDFに白紙を並べる
    const pdfDoc = S.pdfData ? await PDFDocument.load(S.pdfData) : await PDFDocument.create()

    // 白紙を前から順に差し込む。
    // i 番目を入れる時点で i 未満は確定しているので, 添字がそのまま使える。
    // 後ろから入れると, まだ入れていない前方の白紙の分だけ位置がずれる
    for (let i = 0; i < S.sheets.length; i++) {
      const s = S.sheets[i]
      if (s.kind === 'blank') pdfDoc.insertPage(i, [s.width, s.height])
    }

    // 同じ画像は1回だけ埋め込む。
    // 配置サイズが複数あるときは, 一番大きいものに合わせて解像度を決める
    const maxWidthPerImage = new Map<number, number>()
    for (const p of S.placements) {
      const cur = maxWidthPerImage.get(p.imageId) ?? 0
      if (p.dw > cur) maxWidthPerImage.set(p.imageId, p.dw)
    }

    const embedded = new Map<number, Awaited<ReturnType<typeof pdfDoc.embedPng>>>()
    for (const [imageId, maxDw] of maxWidthPerImage) {
      const img = S.images.get(imageId)
      if (!img) continue
      const targetPx = (maxDw / 72) * EXPORT_DPI
      const { bytes, mime } = await encodeForExport(img, targetPx)
      embedded.set(
        imageId,
        mime === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes),
      )
    }

    for (const p of S.placements) {
      const emb = embedded.get(p.imageId)
      if (!emb) continue

      // sheets の並び順 = 書き出し後のページ順なので, 添字をそのまま使える
      const page = pdfDoc.getPage(p.sheetIndex)
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
    a.download = `out-${S.pdfName}.pdf`
    a.click()
    // すぐ revoke すると, ダウンロードが始まる前に URL が死んで
    // 保存が取り消される端末がある (iOS の Safari で起きやすい)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)

    const ms = Math.round(performance.now() - t0)
    const mb = (blob.size / 1024 / 1024).toFixed(2)
    const added = blankCount > 0 ? ` / 白紙 ${blankCount} ページ` : ''
    setStatus(
      `out-${S.pdfName}.pdf を書き出しました (画像 ${S.placements.length} 枚${added} / ${mb} MB / ${ms} ms)`,
    )
  } catch (e) {
    setStatus('書き出しに失敗しました: ' + String(e))
  } finally {
    S.exporting = false
    syncControls()
  }
}
