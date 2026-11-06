// ポインタ操作。
// マウス・タッチ・ペンを1本の経路でさばく。
// setPointerCapture を使うので, 指やカーソルが canvas の外へ出ても届き続ける。
// 以前 window に付けていたのはそれを手でやっていたため
import { HANDLE_PX, MIN_PT, TOUCH_GRAB_PX } from './constants'
import { cornersOf, CORNERS, OPPOSITE } from './coords'
import { overlay, sheetArea } from './dom'
import { drawOverlay, redraw } from './render'
import { pagePlacements, S, selected } from './state'
import type { Corner, Placement } from './types'

// マウス座標 -> 表示pt。
// rect は CSS px, viewScale も 表示pt -> CSS px なので, 実ピクセル数は関係ない
function toDisplayPt(ev: MouseEvent) {
  const rect = overlay.getBoundingClientRect()
  return {
    x: (ev.clientX - rect.left) / S.viewScale,
    y: (ev.clientY - rect.top) / S.viewScale,
  }
}

function hitCorner(p: Placement, x: number, y: number, pointerType = 'mouse'): Corner | null {
  // 指は面で触れるので当たり判定だけ広げる。描く四角の大きさは変えない
  const grab = pointerType === 'touch' ? TOUCH_GRAB_PX : HANDLE_PX * 0.8
  const r = grab / S.viewScale
  const cs = cornersOf(p)
  for (const key of CORNERS) {
    const c = cs[key]
    if (Math.abs(x - c.x) <= r && Math.abs(y - c.y) <= r) return key
  }
  return null
}

function hitBody(p: Placement, x: number, y: number) {
  return x >= p.dx && x <= p.dx + p.dw && y >= p.dy && y <= p.dy + p.dh
}

function updateCursor(ev: MouseEvent) {
  const rect = overlay.getBoundingClientRect()
  if (ev.clientX < rect.left || ev.clientX > rect.right ||
      ev.clientY < rect.top  || ev.clientY > rect.bottom) return

  const { x, y } = toDisplayPt(ev)
  const sel = selected()

  if (sel && sel.sheetIndex === S.pageIndex) {
    const corner = hitCorner(sel, x, y)
    if (corner === 'nw' || corner === 'se') { overlay.style.cursor = 'nwse-resize'; return }
    if (corner === 'ne' || corner === 'sw') { overlay.style.cursor = 'nesw-resize'; return }
  }
  overlay.style.cursor = pagePlacements().some(p => hitBody(p, x, y)) ? 'move' : 'default'
}

function onDown(ev: PointerEvent) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return   // 左ボタンだけ

  const { x, y } = toDisplayPt(ev)
  const list = pagePlacements()

  // 手前にあるものを優先するので後ろから見る
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]

    if (p.id === S.selectedId) {
      const corner = hitCorner(p, x, y, ev.pointerType)
      if (corner) {
        const a = cornersOf(p)[OPPOSITE[corner]]
        S.drag = {
          kind: 'resize', id: p.id, corner,
          anchorX: a.x, anchorY: a.y, aspect: p.dw / p.dh,
        }
        overlay.setPointerCapture(ev.pointerId)
        ev.preventDefault()
        return
      }
    }

    if (hitBody(p, x, y)) {
      S.selectedId = p.id
      S.drag = { kind: 'move', id: p.id, grabDx: x - p.dx, grabDy: y - p.dy }
      overlay.setPointerCapture(ev.pointerId)
      ev.preventDefault()
      redraw()
      return
    }
  }

  // 何にも当たらなかった: 選択を外して, 紙を動かす側に回る
  S.selectedId = null
  S.drag = {
    kind: 'pan',
    startX: ev.clientX, startY: ev.clientY,
    scrollX: sheetArea.scrollLeft, scrollY: sheetArea.scrollTop,
  }
  overlay.setPointerCapture(ev.pointerId)
  redraw()
}

function onMove(ev: PointerEvent) {
  const drag = S.drag
  if (!drag) {
    if (ev.pointerType === 'mouse') updateCursor(ev)
    return
  }
  ev.preventDefault()

  if (drag.kind === 'pan') {
    sheetArea.scrollLeft = drag.scrollX - (ev.clientX - drag.startX)
    sheetArea.scrollTop  = drag.scrollY - (ev.clientY - drag.startY)
    return
  }

  const { x, y } = toDisplayPt(ev)
  const p = S.placements.find(q => q.id === drag.id)
  if (!p) return

  if (drag.kind === 'move') {
    p.dx = x - drag.grabDx
    p.dy = y - drag.grabDy
  } else {
    // 対角のハンドルを固定したまま, 縦横比を保って拡縮
    const rawW = Math.abs(x - drag.anchorX)
    const rawH = Math.abs(y - drag.anchorY)

    let w: number, h: number
    if (rawW / drag.aspect >= rawH) { w = rawW; h = rawW / drag.aspect }
    else                            { h = rawH; w = rawH * drag.aspect }
    w = Math.max(w, MIN_PT)
    h = Math.max(h, MIN_PT / drag.aspect)

    p.dw = w
    p.dh = h
    p.dx = drag.corner === 'nw' || drag.corner === 'sw' ? drag.anchorX - w : drag.anchorX
    p.dy = drag.corner === 'nw' || drag.corner === 'ne' ? drag.anchorY - h : drag.anchorY
  }

  drawOverlay()
}

// pointercancel を拾わないと, システムのジェスチャに取られたとき掴んだままになる
function onUp(ev: PointerEvent) {
  const drag = S.drag
  if (!drag) return
  const moved = drag.kind !== 'pan'
  S.drag = null
  if (overlay.hasPointerCapture(ev.pointerId)) overlay.releasePointerCapture(ev.pointerId)
  if (moved) redraw()
}

export function attachPointer() {
  overlay.addEventListener('pointerdown', onDown)
  overlay.addEventListener('pointermove', onMove)
  overlay.addEventListener('pointerup', onUp)
  overlay.addEventListener('pointercancel', onUp)
}
