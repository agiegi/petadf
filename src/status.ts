import { statusLine } from './dom'

// #status は role="status" aria-live="polite"。書き換えるだけで読み上げられる
export function setStatus(text: string) {
  statusLine.textContent = text
}
