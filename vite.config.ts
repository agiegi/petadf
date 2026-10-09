import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'PetaDF',
        short_name: 'PetaDF',
        description: 'PDFの課題に画像を貼って提出できる形にするツール',
        lang: 'ja',
        theme_color: '#1a73e8',
        background_color: '#f7f4eb',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 既定の対象は js,css,html,ico,png,svg のみ。
        // pdf.worker は .mjs なので明示しないとキャッシュされず, オフラインで落ちる
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,webmanifest}'],
        // pdf.worker が 2.2MB あるので, 既定の上限 (2MB) を超える
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})