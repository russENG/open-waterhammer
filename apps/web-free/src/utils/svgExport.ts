/**
 * SVG チャートの画像エクスポートユーティリティ
 *
 * - SVG 要素を取り出し、SVG ファイルまたは PNG として保存する
 * - すべてブラウザ内で完結（外部依存なし）
 */

const PNG_SCALE = 2; // 高 DPI

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function serializeSvg(svg: SVGSVGElement): string {
  // 明示的に xmlns を付与（serializer によって付かない場合がある）
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  // viewBox から実寸を補完
  const vb = clone.getAttribute("viewBox");
  if (vb) {
    const [, , w, h] = vb.split(/\s+/).map(Number);
    if (w && h) {
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  const xml = serializeSvg(svg);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', xml], {
    type: "image/svg+xml;charset=utf-8",
  });
  downloadBlob(blob, filename.endsWith(".svg") ? filename : `${filename}.svg`);
}

export async function downloadPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const blob = await svgToPngBlob(svg);
  downloadBlob(blob, filename.endsWith(".png") ? filename : `${filename}.png`);
}

export function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xml = serializeSvg(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      // viewBox から論理サイズを取得
      const vb = svg.getAttribute("viewBox");
      let w = svg.clientWidth || 0;
      let h = svg.clientHeight || 0;
      if (vb) {
        const parts = vb.split(/\s+/).map(Number);
        if (parts.length === 4 && parts[2] && parts[3]) {
          w = parts[2];
          h = parts[3];
        }
      }
      if (!w || !h) {
        URL.revokeObjectURL(url);
        reject(new Error("SVG サイズを判定できませんでした"));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * PNG_SCALE);
      canvas.height = Math.round(h * PNG_SCALE);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas 2D コンテキストが取得できません"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 変換に失敗しました"));
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG の読み込みに失敗しました"));
    };
    img.src = url;
  });
}
