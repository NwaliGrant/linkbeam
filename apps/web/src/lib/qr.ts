import qrcode from "qrcode-generator";

/** Width of the empty border around a QR code, in modules. The QR standard asks for at least 4. */
export const QUIET_ZONE = 4;

/** The dark/light squares of a QR code for some text. Medium error correction survives small print smudges. */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

/** A crisp, scalable picture. Always black on white, because scanners read that best. */
export function qrSvg(matrix: boolean[][], pixels = 1024): string {
  const total = matrix.length + QUIET_ZONE * 2;
  let path = "";
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      path += `M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges">` +
    `<title>QR code</title><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  );
}

/** Raw black-and-white pixels (RGBA). Each module is a whole number of pixels, so edges stay sharp. */
export function qrPixels(matrix: boolean[][], targetPixels = 1024): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const total = matrix.length + QUIET_ZONE * 2;
  const scale = Math.max(1, Math.floor(targetPixels / total));
  const side = total * scale;
  const data = new Uint8ClampedArray(new ArrayBuffer(side * side * 4)).fill(255);
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const index = (((y + QUIET_ZONE) * scale + dy) * side + (x + QUIET_ZONE) * scale + dx) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    });
  });
  return { width: side, height: side, data };
}

/** A PNG file made in the browser. Nothing is sent to any server. */
export function qrPng(matrix: boolean[][], targetPixels = 1024): Promise<Blob> {
  const { width, height, data } = qrPixels(matrix, targetPixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("no canvas"));
  context.putImageData(new ImageData(data, width, height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no png"))), "image/png"));
}
