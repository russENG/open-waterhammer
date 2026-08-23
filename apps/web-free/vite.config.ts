import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'path'

import { PYODIDE_RUNTIME_ASSETS } from './pyodide-assets.ts'

const pyodideDirectory = path.dirname(fileURLToPath(import.meta.resolve('pyodide')))

// Build-time git SHA embedded via `define` below: process.env.VITE_GIT_SHA (e.g. set by
// CI) takes priority, then a local `git rev-parse`, then 'unknown' if git isn't available
// (e.g. building from a source tarball). The dev-server fallback ('browser-build', for
// `vite dev` where this define is skipped) lives in workspace-context.tsx instead.
function resolveBuildGitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

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
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(resolveBuildGitSha()),
  },
  resolve: {
    alias: {
      '@open-waterhammer/excel-io': path.resolve(import.meta.dirname, '../../packages/excel-io/src/index.ts'),
      '@open-waterhammer/runner/browser': path.resolve(import.meta.dirname, '../../packages/runner/src/browser.ts'),
      '@open-waterhammer/runner': path.resolve(import.meta.dirname, '../../packages/runner/src/index.ts'),
      '@open-waterhammer/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src/index.ts'),
      '@open-waterhammer/workspace': path.resolve(import.meta.dirname, '../../packages/workspace/src/index.ts'),
      '@open-waterhammer-py': path.resolve(import.meta.dirname, '../../packages/core-py/open_waterhammer'),
      // exceljs ships two browserified dist bundles: the default ("browser" package.json
      // field -> dist/exceljs.min.js) bakes in core-js + regenerator-runtime polyfills for
      // legacy browsers; dist/exceljs.bare.min.js is the same Workbook/Enums surface built
      // from lib/exceljs.bare.js (officially documented in exceljs's README as the
      // "bring your own polyfills" entry point) without that ES5 polyfill payload. Vite's
      // build target is evergreen browsers that already have native Promise/Symbol/
      // Array.find/String.includes/etc., so the polyfills are dead weight here — aliasing
      // to the bare build trims ~85kB with no behavior change.
      'exceljs': path.resolve(import.meta.dirname, '../../node_modules/exceljs/dist/exceljs.bare.min.js'),
    },
  },
  server: {
    fs: {
      // packages/core-py の .py を ?raw で取り込めるようにする
      allow: [path.resolve(import.meta.dirname, '../..')],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Real code splitting (chunkSizeWarningLimit is never touched): pull the exceljs
        // vendor bundle into its own named chunk, separate from our own excel-io wrapper
        // code. It's still only reachable through the existing
        // `import('@open-waterhammer/excel-io')` dynamic import in
        // src/reports/run-exports.ts, so load-time behavior is unchanged — but editing
        // excel-io's own source no longer forces users to re-download the ~850kB vendor
        // blob, since rolldown's automatic chunking now separates it into its own small
        // chunk once exceljs is pulled out.
        //
        // IMPORTANT: do NOT also assign packages/excel-io/src/* to an explicit chunk name
        // here. That was tried and verified to make rolldown merge unrelated lazy chunks
        // (the runner/browser+epanet chunk and the main index entry) into one ~973kB
        // blob — a regression against "keep all lazy boundaries intact". Leaving
        // excel-io/src to automatic chunking avoids that regression and, empirically,
        // still isolates it into its own ~2kB chunk once its heavy neighbor is removed.
        manualChunks(id) {
          if (id.includes('/node_modules/exceljs/')) return 'vendor-exceljs'
        },
      },
    },
  },
})
