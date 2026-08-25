/**
 * GitHub Pages cannot attach an HTTP frame-ancestors or X-Frame-Options header.
 * Refuse to initialize the workspace when another page embeds it, so framed UI
 * cannot be used for clickjacking against locally persisted project data.
 */
export function isEmbedded(
  selfWindow: Window = window.self,
  topWindow: Window | null = window.top,
): boolean {
  return selfWindow !== topWindow
}
