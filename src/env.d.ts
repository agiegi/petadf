// vite.config.ts の define で package.json の version を埋め込む。
// About の表示と package.json が別々に古くなるのを防ぐため
declare global {
  const __APP_VERSION__: string
}

export {}
