import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
  resolve: {
    alias: {
      '@open-waterhammer/excel-io': path.resolve(import.meta.dirname, '../../packages/excel-io/src/index.ts'),
      '@open-waterhammer/runner/browser': path.resolve(import.meta.dirname, '../../packages/runner/src/browser.ts'),
      '@open-waterhammer/runner': path.resolve(import.meta.dirname, '../../packages/runner/src/index.ts'),
      '@open-waterhammer/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src/index.ts'),
      '@open-waterhammer/workspace': path.resolve(import.meta.dirname, '../../packages/workspace/src/index.ts'),
      '@open-waterhammer-py': path.resolve(import.meta.dirname, '../../packages/core-py/open_waterhammer'),
    },
  },
  server: {
    fs: {
      // packages/core-py の .py を ?raw で取り込めるようにする
      allow: [path.resolve(import.meta.dirname, '../..')],
    },
  },
})
