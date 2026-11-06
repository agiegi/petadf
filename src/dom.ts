// index.html の id と結びつく唯一の場所。
// id を変えたらここだけ直せばよい

// 見つからなかったら id を名前に入れて落とす。
// 黙って null を返すと, 真っ白な画面に何も出ないまま後段で落ちて原因が分からない
// (compat.ts が無いときの症状と区別がつかない)
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`#${id} が index.html に見つかりません`)
  return node as T
}

export const pdfInput = el<HTMLInputElement>('pdfInput')
export const imageInput = el<HTMLInputElement>('imageInput')
export const prevButton = el<HTMLButtonElement>('prevButton')
export const nextButton = el<HTMLButtonElement>('nextButton')
export const pageNo = el<HTMLInputElement>('pageNo')
export const pageTotal = el<HTMLSpanElement>('pageTotal')
export const zoomIn = el<HTMLButtonElement>('zoomIn')
export const zoomOut = el<HTMLButtonElement>('zoomOut')
export const zoomFit = el<HTMLButtonElement>('zoomFit')
export const zoomNow = el<HTMLSpanElement>('zoomNow')
export const peelButton = el<HTMLButtonElement>('peelButton')
export const exportButton = el<HTMLButtonElement>('exportButton')
export const addBlankButton = el<HTMLButtonElement>('addBlankButton')
export const dropBlankButton = el<HTMLButtonElement>('dropBlankButton')
export const statusLine = el<HTMLParagraphElement>('status')
export const sheetArea = el<HTMLDivElement>('sheetArea')
export const stage = el<HTMLDivElement>('stage')
export const emptyState = el<HTMLDivElement>('emptyState')
export const dropHint = el<HTMLDivElement>('dropHint')
export const pageCanvas = el<HTMLCanvasElement>('pageCanvas')
export const overlay = el<HTMLCanvasElement>('overlayCanvas')
export const pileList = el<HTMLUListElement>('pileList')
export const pileEmpty = el<HTMLParagraphElement>('pileEmpty')
export const pileCount = el<HTMLSpanElement>('pileCount')

export const aboutButton = el<HTMLButtonElement>('aboutButton')
export const aboutBackdrop = el<HTMLDivElement>('aboutBackdrop')
export const aboutPanel = el<HTMLDivElement>('aboutPanel')
export const aboutClose = el<HTMLButtonElement>('aboutClose')
export const aboutMon = el<HTMLImageElement>('aboutMon')
export const aboutVersion = el<HTMLSpanElement>('aboutVersion')
export const licPdfjs = el<HTMLPreElement>('licPdfjs')
export const licPdflib = el<HTMLPreElement>('licPdflib')
