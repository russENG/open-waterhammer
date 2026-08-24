/**
 * exceljs (packages/excel-io) は Node の `Buffer` を参照する。ブラウザには存在しないため、
 * `buffer` npm パッケージ（webpack/vite でよく使われる polyfill）を動的 import して
 * `globalThis.Buffer` に一度だけ生やす。Node 環境（vitest 等）では既に `Buffer` が
 * グローバルに存在するため `??=` で上書きしない。
 */
export async function ensureBrowserBuffer(): Promise<void> {
  const { Buffer } = await import('buffer')
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  browserGlobal.Buffer ??= Buffer
}
