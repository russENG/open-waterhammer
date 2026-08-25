/** PDFビューアー用のページ指定フラグメントを付ける。 */
export function buildPdfViewUrl(url: string, page?: number): string {
  if (!page) return url

  const baseUrl = url.split('#', 1)[0]
  return `${baseUrl}#page=${page}`
}
