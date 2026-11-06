// 「貼ったもの」一覧パネル。
// canvas の中身は支援技術から見えないので, ここが代替表現になる。
//
// 作り直すとフォーカスが外れる (キーボードで棚を操作している人が位置を失う) ので,
// 構造を作るのと文字を書き換えるのを分けてある。
// 枚数も並びも変わっていなければ textContent の書き換えだけで済ます
import { PT_TO_MM } from './constants'
import { pileCount, pileEmpty, pileList } from './dom'
import { S } from './state'

type Row = {
  li: HTMLLIElement
  pick: HTMLButtonElement
  thumb: HTMLImageElement
  name: HTMLSpanElement
  size: HTMLSpanElement
  peel: HTMLButtonElement
}

let rows: Row[] = []
let builtKey = ''

function buildRow(): Row {
  const li = document.createElement('li')

  const pick = document.createElement('button')
  pick.type = 'button'
  pick.className = 'pile'
  pick.dataset.role = 'pick'

  const thumb = document.createElement('img')
  thumb.alt = ''

  const lines = document.createElement('span')
  lines.className = 'lines'
  const name = document.createElement('span')
  const size = document.createElement('span')
  size.className = 'size'
  lines.append(name, size)
  pick.append(thumb, lines)

  const peel = document.createElement('button')
  peel.type = 'button'
  peel.className = 'peel'
  peel.dataset.role = 'peel'
  peel.textContent = '×'

  li.append(pick, peel)
  return { li, pick, thumb, name, size, peel }
}

export function syncList() {
  const { placements, selectedId, images } = S

  pileEmpty.hidden = placements.length > 0
  pileCount.textContent = placements.length > 0 ? String(placements.length) : ''

  // 並びか枚数が変わったときだけ DOM を組み替える
  const key = placements.map(p => p.id).join(',')
  if (key !== builtKey) {
    while (rows.length < placements.length) rows.push(buildRow())
    rows.length = placements.length
    pileList.replaceChildren(...rows.map(r => r.li))
    builtKey = key
  }

  placements.forEach((p, i) => {
    const row = rows[i]
    const label = `画像 ${i + 1}`
    const img = images.get(p.imageId)

    row.li.dataset.id = String(p.id)
    if (img && row.thumb.src !== img.thumbUrl) row.thumb.src = img.thumbUrl

    const sizeText =
      `${p.sheetIndex + 1}ページ　${Math.round(p.dw * PT_TO_MM)}×${Math.round(p.dh * PT_TO_MM)}mm`

    if (row.name.textContent !== label) row.name.textContent = label
    if (row.size.textContent !== sizeText) row.size.textContent = sizeText
    row.pick.setAttribute('aria-pressed', String(p.id === selectedId))
    row.peel.setAttribute('aria-label', `${label} をはがす`)
  })
}

// 棚の項目から配置の id を引く。クリックは main.ts で委譲して受ける
export function idFromEvent(target: HTMLElement) {
  const hit = target.closest<HTMLElement>('[data-role]')
  const li = hit?.closest<HTMLElement>('li[data-id]')
  if (!hit || !li) return null
  return { id: Number(li.dataset.id), role: hit.dataset.role }
}
