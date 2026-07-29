import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderFilteredReport } from "@/server/reports/pdf";
import { getBrokerRanking, getSummary, listAllEntries, type EntryFilters } from "@/server/queries/entries";
import { getBroker } from "@/server/queries/brokers";
import { formatDate } from "@/lib/formatting/date";
import {
  ENTRY_TYPE_PLURAL_LABELS,
  PROPERTY_TYPE_LABELS,
  AMOUNT_MODE_LABELS,
} from "@/lib/formatting/labels";
import type { AmountMode, EntryType, PropertyType } from "@/lib/finance/types";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF que respeita exatamente os filtros da tela e lista quais foram aplicados.
 * Usa as mesmas funções de consulta das tabelas: os totais precisam bater.
 */
export async function GET(request: NextRequest) {
  try {
    const { branding } = await getReportBranding();
    const params = request.nextUrl.searchParams;

    const filters: EntryFilters = {
      from: params.get("de"),
      to: params.get("ate"),
      entryType: (params.get("tipo") as EntryType) || null,
      brokerId: params.get("corretor"),
      propertyType: (params.get("imovel") as PropertyType) || null,
      commissionMode: (params.get("comissao") as AmountMode) || null,
      search: params.get("busca"),
    };

    const [summary, entries, ranking] = await Promise.all([
      getSummary(filters),
      listAllEntries(filters),
      getBrokerRanking(filters),
    ]);

    const applied: string[] = [];

    applied.push(
      filters.from && filters.to
        ? `Período: ${formatDate(filters.from)} a ${formatDate(filters.to)}`
        : "Período: todo o histórico",
    );

    if (filters.entryType) {
      applied.push(`Tipo de entrada: ${ENTRY_TYPE_PLURAL_LABELS[filters.entryType]}`);
    } else {
      applied.push("Tipo de entrada: vendas e locações");
    }

    if (filters.brokerId) {
      const broker = await getBroker(filters.brokerId);
      applied.push(`Corretor: ${broker?.full_name ?? "—"}`);
    }

    if (filters.propertyType) {
      applied.push(`Tipo do imóvel: ${PROPERTY_TYPE_LABELS[filters.propertyType]}`);
    }

    if (filters.commissionMode) {
      applied.push(`Forma da comissão: ${AMOUNT_MODE_LABELS[filters.commissionMode]}`);
    }

    if (filters.search) {
      applied.push(`Busca textual: "${filters.search}"`);
    }

    const buffer = await renderFilteredReport({
      branding,
      periodLabel:
        filters.from && filters.to
          ? `${formatDate(filters.from)} a ${formatDate(filters.to)}`
          : "Todo o histórico",
      filters: applied,
      summary,
      entries,
      ranking,
    });

    return pdfResponse(buffer, "relatorio-lancamentos.pdf");
  } catch (error) {
    logServerError("reports.filtered", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
