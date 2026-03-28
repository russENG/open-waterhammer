import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@open-waterhammer/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@open-waterhammer/standards': path.resolve(__dirname, '../../packages/standards/src/index.ts'),
      '@open-waterhammer/sample-data': path.resolve(__dirname, '../../packages/sample-data/src/index.ts'),
      '@open-waterhammer/excel-io': path.resolve(__dirname, '../../packages/excel-io/src/index.ts'),
    },
  },
})
