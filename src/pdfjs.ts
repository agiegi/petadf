// pdf.js の読み込み口。worker の場所をここで一度だけ設定する。
// compat.ts より後に評価されること (main.ts の import の順で担保している)
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjsLib }
