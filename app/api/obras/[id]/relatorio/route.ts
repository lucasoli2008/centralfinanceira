import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderWorkReport, type WorkReportInvoice, type WorkReportPhoto } from "@/server/reports/work-pdf";
import {
  appendPdfAttachments,
  downloadAttachment,
  toPdfImage,
  type AppendixSource,
} from "@/server/reports/work-attachments";
import {
  getWork,
  getWorkEntryTotals,
  listWorkActivities,
  listWorkAttachments,
  listWorkEntries,
} from "@/server/queries/works";
import { logServerError } from "@/lib/errors";
import type { WorkAttachmentRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isPhoto = (attachment: WorkAttachmentRow) => attachment.category.startsWith("foto_");
const isImage = (attachment: WorkAttachmentRow) => attachment.mime_type.startsWith("image/");

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { branding } = await getReportBranding();
    const work = await getWork(id);

    if (!work) return new Response("Obra não encontrada.", { status: 404 });

    const [totals, entries, attachments, activities] = await Promise.all([
      getWorkEntryTotals(id),
      listWorkEntries(id),
      listWorkAttachments(id),
      listWorkActivities(id),
    ]);

    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

    // Fotos: baixadas e normalizadas (EXIF, WEBP → JPG, redimensionadas) antes do renderer.
    const photos = (
      await Promise.all(
        attachments
          .filter(isPhoto)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map(async (attachment): Promise<WorkReportPhoto | null> => {
            const buffer = await downloadAttachment(attachment.storage_path);
            if (!buffer) return null;
            const image = await toPdfImage(buffer, attachment.mime_type);
            if (!image) return null;
            return { id: attachment.id, category: attachment.category, caption: attachment.description, image };
          }),
      )
    ).filter((photo): photo is WorkReportPhoto => photo !== null);

    // Documentos: imagens embutidas; PDFs colados ao final como anexos numerados.
    const documents = attachments.filter((attachment) => !isPhoto(attachment));
    const appendixSources: AppendixSource[] = [];
    const invoices: WorkReportInvoice[] = [];

    for (const attachment of documents) {
      const entry = attachment.work_entry_id ? entriesById.get(attachment.work_entry_id) : undefined;
      const base: Omit<WorkReportInvoice, "image" | "appendixNumber" | "skipped"> = {
        id: attachment.id,
        fileName: attachment.file_name,
        category: attachment.category,
        createdAt: attachment.created_at,
        description: attachment.description,
        entry: entry
          ? { description: entry.description, totalAmount: entry.total_amount, isPaid: entry.is_paid, paidAt: entry.paid_at }
          : null,
      };

      const buffer = await downloadAttachment(attachment.storage_path);

      if (buffer && isImage(attachment)) {
        const image = await toPdfImage(buffer, attachment.mime_type);
        invoices.push({ ...base, image, appendixNumber: null, skipped: false });
        continue;
      }

      if (buffer && attachment.mime_type === "application/pdf") {
        const appendixNumber = appendixSources.length + 1;
        appendixSources.push({
          id: attachment.id,
          label: `Anexo ${appendixNumber} · ${attachment.file_name}`,
          buffer,
        });
        invoices.push({ ...base, image: null, appendixNumber, skipped: false });
        continue;
      }

      invoices.push({ ...base, image: null, appendixNumber: null, skipped: false });
    }

    let report = await renderWorkReport({ branding, work, totals, entries, photos, invoices, activities });

    if (appendixSources.length > 0) {
      const { pdf, skipped } = await appendPdfAttachments(report, appendixSources);
      if (skipped.length > 0) {
        // Re-renderiza com os anexos que não couberam marcados, para o texto do relatório bater.
        const skippedIds = new Set(skipped);
        const adjusted = invoices.map((invoice) =>
          skippedIds.has(invoice.id) ? { ...invoice, appendixNumber: null, skipped: true } : invoice,
        );
        const rerendered = await renderWorkReport({ branding, work, totals, entries, photos, invoices: adjusted, activities });
        report = (await appendPdfAttachments(rerendered, appendixSources.filter((source) => !skippedIds.has(source.id)))).pdf;
      } else {
        report = pdf;
      }
    }

    return pdfResponse(report, `obra-${work.code}.pdf`);
  } catch (error) {
    logServerError("reports.work", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
