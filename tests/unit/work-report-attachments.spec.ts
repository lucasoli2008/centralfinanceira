import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { appendPdfAttachments, toPdfImage } from "@/server/reports/work-attachments";

async function makeImage(format: "webp" | "png" | "jpeg", width = 40, height = 20): Promise<Buffer> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  });
  if (format === "webp") return pipeline.webp().toBuffer();
  if (format === "png") return pipeline.png().toBuffer();
  return pipeline.jpeg().toBuffer();
}

async function makePdf(pages: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([300, 200]);
  return Buffer.from(await document.save());
}

describe("toPdfImage", () => {
  it("converte WEBP (não suportado pelo react-pdf) em JPG", async () => {
    const result = await toPdfImage(await makeImage("webp"), "image/webp");
    expect(result?.format).toBe("jpg");
    const meta = await sharp(result!.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(40);
  });

  it("reduz imagens largas sem ampliar as pequenas", async () => {
    const wide = await toPdfImage(await makeImage("jpeg", 3000, 1000), "image/jpeg");
    const wideMeta = await sharp(wide!.data).metadata();
    expect(wideMeta.width).toBe(1400);

    const small = await toPdfImage(await makeImage("png", 100, 50), "image/png");
    const smallMeta = await sharp(small!.data).metadata();
    expect(smallMeta.width).toBe(100);
  });

  it("devolve null para bytes que não são imagem", async () => {
    expect(await toPdfImage(Buffer.from("isto não é uma imagem"), "image/webp")).toBeNull();
  });
});

describe("appendPdfAttachments", () => {
  it("cola as páginas dos anexos ao final do relatório, na ordem", async () => {
    const report = await makePdf(2);
    const result = await appendPdfAttachments(report, [
      { id: "a", label: "Anexo 1 · nf-a.pdf", buffer: await makePdf(1) },
      { id: "b", label: "Anexo 2 · nf-b.pdf", buffer: await makePdf(3) },
    ]);

    const merged = await PDFDocument.load(result.pdf);
    expect(merged.getPageCount()).toBe(6);
    expect(result.skipped).toEqual([]);
  });

  it("pula anexos que estourariam o limite de páginas e anexos ilegíveis", async () => {
    const report = await makePdf(1);
    const result = await appendPdfAttachments(report, [
      { id: "big", label: "Anexo 1 · grande.pdf", buffer: await makePdf(41) },
      { id: "broken", label: "Anexo 2 · quebrado.pdf", buffer: Buffer.from("%PDF-nada") },
      { id: "ok", label: "Anexo 3 · ok.pdf", buffer: await makePdf(2) },
    ]);

    const merged = await PDFDocument.load(result.pdf);
    expect(merged.getPageCount()).toBe(3);
    expect(result.skipped).toEqual(["big", "broken"]);
  });

  it("devolve o relatório intacto quando não há anexos", async () => {
    const report = await makePdf(1);
    const result = await appendPdfAttachments(report, []);
    expect(result.pdf).toBe(report);
  });
});
