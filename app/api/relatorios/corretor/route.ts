import type { NextRequest } from "next/server";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderBrokerReport } from "@/server/reports/pdf";
import { getBrokerStatement } from "@/server/queries/entries";
import { getBroker } from "@/server/queries/brokers";
import { roundMoney, safeRatio } from "@/lib/finance/engine";
import { formatDate } from "@/lib/formatting/date";
import { logServerError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { branding } = await getReportBranding();
    const params = request.nextUrl.searchParams;

    const brokerId = params.get("corretor");
    if (!brokerId) {
      return new Response("Informe o corretor do relatório.", { status: 400 });
    }

    const from = params.get("de");
    const to = params.get("ate");

    const [broker, statement] = await Promise.all([
      getBroker(brokerId),
      getBrokerStatement(brokerId, from, to),
    ]);

    if (!broker) {
      return new Response("Corretor não encontrado.", { status: 404 });
    }

    const totalPayout = roundMoney(
      statement.reduce((total, row) => total + Number(row.payout_amount), 0),
    );

    const periodLabel =
      from && to
        ? `Período: ${formatDate(from)} a ${formatDate(to)}`
        : "Período: todo o histórico";

    const buffer = await renderBrokerReport({
      branding,
      brokerName: broker.full_name,
      periodLabel,
      statement,
      totalPayout,
      averagePayout: safeRatio(totalPayout, statement.length) ?? 0,
    });

    return pdfResponse(
      buffer,
      `relatorio-corretor-${broker.full_name.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    );
  } catch (error) {
    logServerError("reports.broker", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
