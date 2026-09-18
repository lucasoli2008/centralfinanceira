import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { appendPdfAttachments, toPdfImage } from "@/server/reports/work-attachments";
import { makeFakeJpegBytes, makePng } from "../helpers/fake-images";

async function makePdf(pages: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([300, 200]);
  return Buffer.from(await document.save());
}

describe("toPdfImage", () => {
  it("passa adiante um PNG válido sem alterar os bytes", async () => {
    const png = makePng(40, 20);
    const result = await toPdfImage(png, "image/png");
    expect(result?.format).toBe("png");
    expect(result?.data).toBe(png);
  });

  it("passa adiante um JPEG válido (checado pelos bytes mágicos) sem alterar os bytes", async () => {
    const jpeg = makeFakeJpegBytes();
    const result = await toPdfImage(jpeg, "image/jpeg");
    expect(result?.format).toBe("jpg");
    expect(result?.data).toBe(jpeg);
  });

  it("devolve null para WEBP — o @react-pdf/renderer não decodifica esse formato", async () => {
    const png = makePng(10, 10);
    expect(await toPdfImage(png, "image/webp")).toBeNull();
  });

  it("devolve null quando os bytes não batem com o mime_type declarado", async () => {
    expect(await toPdfImage(Buffer.from("isto não é uma imagem"), "image/jpeg")).toBeNull();
    expect(await toPdfImage(Buffer.from("isto não é uma imagem"), "image/png")).toBeNull();
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
