// キーボード操作。
// マウスが使えなくても, 選択・移動・拡縮・はがすが全部できるようにする
import { PT_TO_MM } from './constants'
import { redraw } from './render'
import { peelSelected, scaleSelected } from './select'
import { S, selected } from './state'
import { setStatus } from './status'

function onKeyDown(ev: KeyboardEvent) {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return

  if (ev.key === 'Escape' && S.selectedId !== null) {
    S.selectedId = null
    redraw()
    setStatus('選択を外しました')
    return
  }

  const p = selected()
  if (!p) return

  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    peelSelected()
    ev.preventDefault()
    return
  }

  if (ev.key === '+' || ev.key === '=') { scaleSelected(1.05); ev.preventDefault(); return }
  if (ev.key === '-' || ev.key === '_') { scaleSelected(1 / 1.05); ev.preventDefault(); return }

  const step = ev.shiftKey ? 10 : 1
  let moved = true
  switch (ev.key) {
    case 'ArrowLeft':  p.dx -= step; break
    case 'ArrowRight': p.dx += step; break
    case 'ArrowUp':    p.dy -= step; break
    case 'ArrowDown':  p.dy += step; break
    default: moved = false
  }
  if (moved) {
    redraw()
    setStatus(`位置 左から ${Math.round(p.dx * PT_TO_MM)} mm, 上から ${Math.round(p.dy * PT_TO_MM)} mm`)
    ev.preventDefault()
  }
}

export function attachKeys() {
  window.addEventListener('keydown', onKeyDown)
}
