import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { cspPlugin } from './build/csp.ts'
import { DEFAULT_APP_ID, manifest } from './build/manifest.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** GitHub Pages runs Jekyll, which drops files whose names start with "_" (and "."). */
const jekyllSafe = (name: string) => name.replace(/[^\w.-]/g, '-').replace(/^[_.-]+/, '')

export default defineConfig({
  // Relative, so one build works under /Beyond-Website/app/, in `vite preview` and anywhere else.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      includeManifestIcons: true,
      manifest: manifest(process.env.APP_ID ?? DEFAULT_APP_ID),
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webmanifest}'],
        // Only iOS reads the splash screens; the screenshots are for install dialogs.
        globIgnores: ['**/apple-splash-*.png', 'screenshots/**', 'engine/**'],
        // The backtest engine (5 MB) is fetched the first time a backtest runs, not at install, then kept. Its
        // framework files carry a hash in their names; dotnet.js and version.json do not, so they are asked for first.
        runtimeCaching: [
          { urlPattern: /\/engine\/(framework\/dotnet\.js|version\.json)$/, handler: 'NetworkFirst', options: { cacheName: 'engine-entry' } },
          { urlPattern: /\/engine\/framework\//, handler: 'CacheFirst', options: { cacheName: 'engine', expiration: { maxEntries: 60 } } },
        ],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        sourcemap: false,
      },
    }),
    cspPlugin(),
  ],
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 4173, strictPort: true },
  build: {
    outDir: '../app',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: { output: { sanitizeFileName: jekyllSafe } },
  },
})
