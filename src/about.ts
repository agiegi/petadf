// 「このツールについて」のダイアログ。
// 他の部分と結合していないので, ここで完結させている
import pdflibLicense from '../node_modules/pdf-lib/LICENSE.md?raw'
import pdfjsLicense from '../node_modules/pdfjs-dist/LICENSE?raw'
import {
  aboutBackdrop, aboutButton, aboutClose, aboutMon, aboutPanel, aboutVersion,
  licPdflib, licPdfjs,
} from './dom'
import monUrl from './oh-gy-mon.png?url'

let open = false
let lastFocus: HTMLElement | null = null

function openAbout() {
  lastFocus = document.activeElement as HTMLElement
  open = true
  aboutBackdrop.classList.add('open')
  aboutClose.focus()
}

function closeAbout() {
  open = false
  aboutBackdrop.classList.remove('open')
  lastFocus?.focus()   // 開く前にいた場所へ戻す
}

export function attachAbout() {
  aboutMon.src = monUrl
  licPdfjs.textContent = pdfjsLicense
  licPdflib.textContent = pdflibLicense
  aboutVersion.textContent = __APP_VERSION__

  aboutButton.addEventListener('click', openAbout)
  aboutClose.addEventListener('click', closeAbout)

  aboutBackdrop.addEventListener('click', ev => {
    if (ev.target === aboutBackdrop) closeAbout()
  })

  // 開いている間はフォーカスをパネルの中に閉じ込める。
  // capture 段階で処理するので, 本体のキーボード処理に手を入れなくて済む
  window.addEventListener('keydown', ev => {
    if (!open) return

    if (ev.key === 'Escape') { closeAbout(); ev.stopPropagation(); return }

    if (ev.key === 'Tab') {
      const focusable = aboutPanel.querySelectorAll<HTMLElement>(
        'button, [href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length > 0) {
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (ev.shiftKey && document.activeElement === first) { last.focus(); ev.preventDefault() }
        else if (!ev.shiftKey && document.activeElement === last) { first.focus(); ev.preventDefault() }
      }
    }

    ev.stopPropagation()
  }, true)
}
