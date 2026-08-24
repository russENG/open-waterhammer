import react from '@vitejs/plugin-react'
import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@open-waterhammer/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src/index.ts'),
      '@open-waterhammer/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
      '@open-waterhammer/epanet-adapter': path.resolve(import.meta.dirname, '../../packages/epanet-adapter/src/index.ts'),
      '@open-waterhammer/excel-io': path.resolve(import.meta.dirname, '../../packages/excel-io/src/index.ts'),
      '@open-waterhammer/runner/browser': path.resolve(import.meta.dirname, '../../packages/runner/src/browser.ts'),
      '@open-waterhammer/runner': path.resolve(import.meta.dirname, '../../packages/runner/src/index.ts'),
      '@open-waterhammer/sample-data': path.resolve(import.meta.dirname, '../../packages/sample-data/src/index.ts'),
      '@open-waterhammer/standards': path.resolve(import.meta.dirname, '../../packages/standards/src/index.ts'),
      '@open-waterhammer/workspace': path.resolve(import.meta.dirname, '../../packages/workspace/src/index.ts'),
      '@open-waterhammer-py': path.resolve(import.meta.dirname, '../../packages/core-py/open_waterhammer'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    css: false,
    restoreMocks: true,
  },
})
