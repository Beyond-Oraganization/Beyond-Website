import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'mock-bot/**/*.test.mjs', 'scripts/**/*.test.mjs'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
  },
})
