import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'path'

import { PYODIDE_RUNTIME_ASSETS } from './pyodide-assets.ts'

const pyodideDirectory = path.dirname(fileURLToPath(import.meta.resolve('pyodide')))

function selfHostedPyodide() {
  return {
    name: 'self-hosted-pyodide',
    buildStart() {
      for (const fileName of PYODIDE_RUNTIME_ASSETS) {
        this.emitFile({ type: 'asset', fileName: `pyodide/${fileName}`, source: readFileSync(path.join(pyodideDirectory, fileName)) })
      }
    },
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const match = new URL(request.url ?? '/', 'http://vite.local').pathname.match(/\/pyodide\/([^/]+)$/)
        const fileName = match?.[1]
        if (!fileName || !PYODIDE_RUNTIME_ASSETS.includes(fileName as typeof PYODIDE_RUNTIME_ASSETS[number])) return next()
        const contentTypes: Record<string, string> = {
          '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
          '.wasm': 'application/wasm', '.zip': 'application/zip',
        }
        response.setHeader('Content-Type', contentTypes[path.extname(fileName)] ?? 'application/octet-stream')
        response.end(readFileSync(path.join(pyodideDirectory, fileName)))
      })
    },
  } satisfies import('vite').Plugin
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), selfHostedPyodide()],
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
