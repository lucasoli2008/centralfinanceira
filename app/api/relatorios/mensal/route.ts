import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderMonthlyReport } from "@/server/reports/pdf";
import { getBrokerRanking, getSummary, listAllEntries } from "@/server/queries/entries";
import { addMonths, firstDayOfMonth, lastDayOfMonth } from "@/lib/formatting/date";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { branding } = await getReportBranding();

    const year = Number(request.nextUrl.searchParams.get("ano"));
    const month = Number(request.nextUrl.searchParams.get("mes"));

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return new Response("Informe o ano e o mês do relatório.", { status: 400 });
    }

    const from = firstDayOfMonth(year, month);
    const to = lastDayOfMonth(year, month);
    const previous = addMonths(year, month, -1);

    const [summary, previousSummary, entries, ranking] = await Promise.all([
      getSummary({ from, to }),
      getSummary({
        from: firstDayOfMonth(previous.year, previous.month),
        to: lastDayOfMonth(previous.year, previous.month),
      }),
      listAllEntries({ from, to }),
      getBrokerRanking({ from, to }),
    ]);

    const buffer = await renderMonthlyReport({
      branding,
      year,
      month,
      summary,
      previousSummary,
      entries,
      ranking,
    });

    return pdfResponse(buffer, `relatorio-mensal-${year}-${String(month).padStart(2, "0")}.pdf`);
  } catch (error) {
    logServerError("reports.monthly", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
