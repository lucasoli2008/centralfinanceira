import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderAnnualReport } from "@/server/reports/pdf";
import { getBrokerRanking, getMonthlySeries, getSummary } from "@/server/queries/entries";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { branding } = await getReportBranding();

    const year = Number(request.nextUrl.searchParams.get("ano")) || new Date().getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const [summary, previousSummary, series, ranking] = await Promise.all([
      getSummary({ from, to }),
      getSummary({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }),
      getMonthlySeries(from, to),
      getBrokerRanking({ from, to }),
    ]);

    const buffer = await renderAnnualReport({
      branding,
      year,
      summary,
      previousSummary,
      series,
      ranking,
    });

    return pdfResponse(buffer, `relatorio-anual-${year}.pdf`);
  } catch (error) {
    logServerError("reports.annual", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
