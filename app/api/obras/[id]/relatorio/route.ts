import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderWorkReport, type WorkReportDocument, type WorkReportPhoto } from "@/server/reports/pdf";
import {
  getSignedAttachmentUrl,
  getWork,
  getWorkEntryTotals,
  listWorkAttachments,
  listWorkEntries,
} from "@/server/queries/works";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { branding } = await getReportBranding();
    const work = await getWork(id);

    if (!work) return new Response("Obra não encontrada.", { status: 404 });

    const [totals, entries, attachments] = await Promise.all([
      getWorkEntryTotals(id),
      listWorkEntries(id),
      listWorkAttachments(id),
    ]);

    const photoAttachments = attachments.filter((attachment) => attachment.category.startsWith("foto_"));
    const documentAttachments = attachments.filter((attachment) => !attachment.category.startsWith("foto_"));

    const photos: WorkReportPhoto[] = (
      await Promise.all(
        photoAttachments.map(async (attachment) => {
          const url = await getSignedAttachmentUrl(attachment.storage_path);
          if (!url) return null;
          return { url, category: attachment.category, description: attachment.description };
        }),
      )
    ).filter((photo): photo is WorkReportPhoto => photo !== null);

    const documents: WorkReportDocument[] = documentAttachments.map((attachment) => ({
      fileName: attachment.file_name,
      category: attachment.category,
      createdAt: attachment.created_at,
    }));

    const buffer = await renderWorkReport({ branding, work, totals, entries, photos, documents });

    return pdfResponse(buffer, `obra-${work.code}.pdf`);
  } catch (error) {
    logServerError("reports.work", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
