import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderWorksListReport } from "@/server/reports/work-pdf";
import { getWorksAggregates, listAllWorks, type WorkFilters } from "@/server/queries/works";
import { toCsv, type CsvColumn } from "@/lib/csv";
import { formatDate } from "@/lib/formatting/date";
import { WORK_CATEGORY_LABELS, WORK_PRIORITY_LABELS, WORK_STATUS_LABELS } from "@/lib/formatting/labels";
import type { WorkCategory, WorkPriority, WorkStatus } from "@/types/database";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_COLUMNS: CsvColumn[] = [
  { key: "code", header: "Código" },
  { key: "title", header: "Título" },
  { key: "propertyLabel", header: "Imóvel" },
  { key: "ownerLabel", header: "Proprietário" },
  { key: "status", header: "Status" },
  { key: "category", header: "Categoria" },
  { key: "priority", header: "Prioridade" },
  { key: "startedAt", header: "Início" },
  { key: "expectedAt", header: "Previsão" },
  { key: "completedAt", header: "Conclusão" },
  { key: "totalAmount", header: "Gasto total" },
  { key: "paidAmount", header: "Pago" },
  { key: "unpaidAmount", header: "A pagar" },
  { key: "archived", header: "Arquivada" },
];

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const formato = params.get("formato") === "csv" ? "csv" : "pdf";

    const filters: WorkFilters = {
      from: params.get("de"),
      to: params.get("ate"),
      status: (params.get("status") as WorkStatus) || null,
      category: (params.get("categoria") as WorkCategory) || null,
      priority: (params.get("prioridade") as WorkPriority) || null,
      search: params.get("busca"),
      includeArchived: params.get("arquivadas") === "1",
    };

    const works = await listAllWorks(filters);
    const aggregates = await getWorksAggregates(works.map((work) => work.id));

    const applied: string[] = [];
    applied.push(
      filters.from && filters.to
        ? `Início entre ${formatDate(filters.from)} e ${formatDate(filters.to)}`
        : "Período: todo o histórico",
    );
    if (filters.status) applied.push(`Status: ${WORK_STATUS_LABELS[filters.status]}`);
    if (filters.category) applied.push(`Categoria: ${WORK_CATEGORY_LABELS[filters.category]}`);
    if (filters.priority) applied.push(`Prioridade: ${WORK_PRIORITY_LABELS[filters.priority]}`);
    if (filters.search) applied.push(`Busca: "${filters.search}"`);
    applied.push(filters.includeArchived ? "Inclui obras arquivadas" : "Somente obras ativas");

    if (formato === "csv") {
      const rows = works.map((work) => {
        const aggregate = aggregates.get(work.id);
        const total = aggregate?.totalAmount ?? 0;
        const paid = aggregate?.paidAmount ?? 0;
        return {
          code: work.code,
          title: work.title,
          propertyLabel: work.property_label,
          ownerLabel: work.owner_label,
          status: WORK_STATUS_LABELS[work.status],
          category: WORK_CATEGORY_LABELS[work.category],
          priority: WORK_PRIORITY_LABELS[work.priority],
          startedAt: work.started_at ? formatDate(work.started_at) : "",
          expectedAt: work.expected_at ? formatDate(work.expected_at) : "",
          completedAt: work.completed_at ? formatDate(work.completed_at) : "",
          totalAmount: total,
          paidAmount: paid,
          unpaidAmount: Math.max(0, Math.round((total - paid) * 100) / 100),
          archived: work.is_archived ? "Sim" : "Não",
        };
      });

      const csv = toCsv(rows, CSV_COLUMNS);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="relatorio-obras.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    const { branding } = await getReportBranding();
    const buffer = await renderWorksListReport({
      branding,
      periodLabel:
        filters.from && filters.to
          ? `${formatDate(filters.from)} a ${formatDate(filters.to)}`
          : "Todo o histórico",
      filters: applied,
      rows: works.map((work) => ({
        code: work.code,
        title: work.title,
        propertyLabel: work.property_label,
        status: work.status,
        startedAt: work.started_at,
        totalAmount: aggregates.get(work.id)?.totalAmount ?? 0,
        paidAmount: aggregates.get(work.id)?.paidAmount ?? 0,
      })),
    });

    return pdfResponse(buffer, "relatorio-obras.pdf");
  } catch (error) {
    logServerError("reports.works", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
