import { crc32, deflateSync } from "node:zlib";

/**
 * Constrói um PNG real (RGB, sem paleta) só com `node:zlib` — sem depender de
 * nenhuma lib de imagem — para usar como fixture em testes de PDF.
 */
export function makePng(width: number, height: number, rgb: [number, number, number] = [200, 40, 40]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
    return Buffer.concat([length, typeAndData, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = rgb[0];
      raw[pixelStart + 1] = rgb[1];
      raw[pixelStart + 2] = rgb[2];
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Bytes suficientes para passar na checagem de "bytes mágicos" de JPEG
 * (`toPdfImage`) sem precisar de um encoder JPEG real — usado só para testar
 * o caminho de passagem, não a decodificação de imagem em si.
 */
export function makeFakeJpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}
