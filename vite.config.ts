import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: "/pixels/",
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: {
        disabled: false,
        config: false,
      },
      manifest: {
        name: 'pixels',
        short_name: 'pixels',
        description: 'Pixel-by-number image viewer and editor',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: false,
        navigateFallback: 'index.html',
        suppressWarnings: true,
        type: 'module',
      },
    }),
  ],
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
})
