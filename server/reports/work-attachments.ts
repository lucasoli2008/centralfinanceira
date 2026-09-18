import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";

const BUCKET = "work-attachments";

/** Limite de páginas de anexos coladas ao final do relatório (proteção contra PDFs gigantes). */
export const MAX_APPENDIX_PAGES = 40;

export interface PdfImage {
  data: Buffer;
  format: "jpg" | "png";
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Baixa o objeto do Storage com a sessão do usuário (RLS do bucket continua valendo). */
export async function downloadAttachment(storagePath: string): Promise<Buffer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);

  if (error || !data) {
    logServerError("reports.downloadAttachment", error ?? new Error(`Sem dados para ${storagePath}`));
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}

/**
 * Prepara uma imagem para o `@react-pdf/renderer`, que só decodifica JPEG e
 * PNG nativamente — sem depender de um binário nativo de imagem (ex.: sharp),
 * que a Vercel remove do pacote de funções serverless que não sejam o próprio
 * otimizador de imagem do Next.js. Por isso não há redimensionamento nem
 * correção de orientação EXIF aqui: só passa adiante o que o renderer já
 * sabe ler, validando pelos bytes mágicos do formato (não confia só no
 * `mime_type` salvo no banco). WEBP (e qualquer outro formato) não é
 * suportado pelo renderer e é omitido do PDF.
 */
export async function toPdfImage(buffer: Buffer, mimeType: string): Promise<PdfImage | null> {
  if (mimeType === "image/jpeg" && buffer.subarray(0, 3).equals(JPEG_MAGIC)) {
    return { data: buffer, format: "jpg" };
  }
  if (mimeType === "image/png" && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return { data: buffer, format: "png" };
  }
  return null;
}

export interface AppendixSource {
  id: string;
  /** Rótulo carimbado no topo de cada página colada, ex.: "Anexo 2 · nf-1234.pdf". */
  label: string;
  buffer: Buffer;
}

export interface AppendixResult {
  pdf: Buffer;
  /** Anexos que não couberam no limite ou não puderam ser lidos. */
  skipped: string[];
}

/**
 * Cola as páginas dos PDFs anexados ao final do relatório, respeitando
 * MAX_APPENDIX_PAGES, e carimba cada página com o rótulo do anexo.
 */
export async function appendPdfAttachments(report: Buffer, sources: AppendixSource[]): Promise<AppendixResult> {
  if (sources.length === 0) return { pdf: report, skipped: [] };

  const document = await PDFDocument.load(report);
  const stampFont = await document.embedFont(StandardFonts.Helvetica);
  const skipped: string[] = [];
  let appended = 0;

  for (const source of sources) {
    try {
      const attachment = await PDFDocument.load(source.buffer, { ignoreEncryption: true });
      const count = attachment.getPageCount();
      if (appended + count > MAX_APPENDIX_PAGES) {
        skipped.push(source.id);
        continue;
      }

      const pages = await document.copyPages(attachment, attachment.getPageIndices());
      for (const page of pages) {
        const { width, height } = page.getSize();
        // Helvetica padrão do PDF só cobre WinAnsi: troca caracteres fora do Latin-1.
        const text = source.label.replace(/[^\x20-\x7E -ÿ]/g, "?");
        const size = 8;
        const textWidth = stampFont.widthOfTextAtSize(text, size);
        page.drawRectangle({
          x: width - textWidth - 24,
          y: height - 22,
          width: textWidth + 14,
          height: 14,
          color: rgb(0.98, 0.98, 0.97),
          borderColor: rgb(0.9, 0.9, 0.89),
          borderWidth: 0.5,
        });
        page.drawText(text, {
          x: width - textWidth - 17,
          y: height - 18,
          size,
          font: stampFont,
          color: rgb(0.34, 0.33, 0.31),
        });
        document.addPage(page);
      }
      appended += count;
    } catch (error) {
      logServerError("reports.appendPdfAttachments", error);
      skipped.push(source.id);
    }
  }

  const bytes = await document.save({ useObjectStreams: true });
  return { pdf: Buffer.from(bytes), skipped };
}
