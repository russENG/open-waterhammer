import { describe, expect, test } from 'vitest'

import { PYODIDE_RUNTIME_ASSETS, resolvePyodideIndexUrl } from '../pyodide-bridge'

describe('self-hosted browser Python runtime', () => {
  test('resolves every Pyodide request below the static application BASE_URL', () => {
    expect(resolvePyodideIndexUrl('/open-waterhammer/', 'https://design.example')).toBe('https://design.example/open-waterhammer/pyodide/')
    expect(PYODIDE_RUNTIME_ASSETS).toEqual([
      'pyodide-lock.json',
      'pyodide.asm.mjs',
      'pyodide.asm.wasm',
      'pyodide.js',
      'pyodide.mjs',
      'python_stdlib.zip',
    ])
  })
})
