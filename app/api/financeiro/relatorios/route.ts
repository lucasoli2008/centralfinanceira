import type { NextRequest } from "next/server";
import { requireFinance } from "@/lib/auth/session";
import { resolvePeriod, type PeriodParams } from "@/lib/period";
import { formatMonthYear } from "@/lib/formatting/date";
import { logServerError } from "@/lib/errors";
import { getReportBranding, pdfResponse } from "@/server/reports/branding";
import { renderClosingReport, renderDreReport } from "@/server/reports/finance-pdf";
import { buildDreWorkbook, buildEntriesWorkbook, buildProjectionWorkbook, xlsxResponse } from "@/server/reports/finance-xlsx";
import { getFinAccountBalances, getFinSummary, listFinEntries } from "@/server/queries/finance";
import { getCashProjection, getCloseChecklist, getDre, listPeriodCloses } from "@/server/queries/finance-reports";
import type { FinEntryDetailRow, FinRegime, FinSummaryRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ENTRIES = 10_000;

function periodParams(search: URLSearchParams): PeriodParams {
  return {
    periodo: search.get("periodo") ?? undefined,
    ano: search.get("ano") ?? undefined,
    mes: search.get("mes") ?? undefined,
    de: search.get("de") ?? undefined,
    ate: search.get("ate") ?? undefined,
  } as PeriodParams;
}

/**
 * Exportações do Controle Financeiro (PDF e Excel). Usam exatamente as mesmas
 * consultas das telas; a permissão é checada aqui e de novo pela RLS.
 */
export async function GET(request: NextRequest) {
  try {
    await requireFinance("view");
    const { branding } = await getReportBranding();
    const search = request.nextUrl.searchParams;
    const tipo = search.get("tipo");
    const formato = search.get("formato") === "xlsx" ? "xlsx" : "pdf";

    if (tipo === "dre") {
      const period = resolvePeriod(periodParams(search));
      const regime: FinRegime = search.get("regime") === "caixa" ? "caixa" : "competencia";
      const dre = await getDre(period.from, period.to, regime);
      const subtitle = `${period.label} · regime de ${regime === "caixa" ? "caixa" : "competência"}`;
      const filename = `dre-${period.from}-${period.to}`;
      if (formato === "xlsx") return xlsxResponse(await buildDreWorkbook(dre, branding.organizationName, subtitle), `${filename}.xlsx`);
      return pdfResponse(await renderDreReport({ branding, title: "DRE gerencial", subtitle, dre }), `${filename}.pdf`);
    }

    if (tipo === "fluxo") {
      const days = [30, 60, 90, 180].includes(Number(search.get("horizonte"))) ? Number(search.get("horizonte")) : 90;
      const bucketParam = search.get("agrupar");
      const bucket = bucketParam === "day" || bucketParam === "month" ? bucketParam : days === 180 ? "month" : "week";
      const includeForecasts = search.get("previsoes") !== "nao";
      const rows = await getCashProjection(days, bucket, includeForecasts);
      return xlsxResponse(
        await buildProjectionWorkbook(rows, branding.organizationName, `Próximos ${days} dias${includeForecasts ? ", com previsões" : ""}`),
        `fluxo-projetado-${days}-dias.xlsx`,
      );
    }

    if (tipo === "lancamentos") {
      const period = resolvePeriod(periodParams(search));
      const rows: FinEntryDetailRow[] = [];
      for (let page = 1; rows.length < MAX_ENTRIES; page++) {
        const { rows: batch, total } = await listFinEntries(
          { view: "all", from: period.from, to: period.to, dateField: "competence_date" },
          { page, pageSize: 1000 },
        );
        rows.push(...batch);
        if (batch.length < 1000 || rows.length >= total) break;
      }
      return xlsxResponse(
        await buildEntriesWorkbook(rows.slice(0, MAX_ENTRIES), branding.organizationName, period.label),
        `lancamentos-${period.from}-${period.to}.xlsx`,
      );
    }

    if (tipo === "fechamento") {
      const year = Number(search.get("ano"));
      const month = Number(search.get("mes"));
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return new Response("Informe o ano e o mês do fechamento.", { status: 400 });
      }
      const from = `${year}-${String(month).padStart(2, "0")}-01`;
      const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      const [closes, dre, checklist, balances, liveSummary] = await Promise.all([
        listPeriodCloses(year),
        getDre(from, to, "competencia"),
        getCloseChecklist(year, month),
        getFinAccountBalances(to),
        getFinSummary({ from, to, regime: "competencia" }),
      ]);
      const close = closes.find((item) => item.month === month && !item.reopened_at);
      const snapshot = close?.snapshot?.competencia as Record<string, unknown> | undefined;
      const summary = snapshot
        ? (Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, Number(value)])) as unknown as FinSummaryRow)
        : liveSummary;
      const label = formatMonthYear(year, month);
      const status = close
        ? `Fechado em ${new Date(close.closed_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${close.closed_by_name ? ` por ${close.closed_by_name}` : ""}. Resumo do retrato guardado no fechamento.`
        : "Mês ainda aberto — valores podem mudar.";
      return pdfResponse(
        await renderClosingReport({ branding, label, status, notes: close?.notes ?? null, summary, dre, checklist, balances }),
        `fechamento-${year}-${String(month).padStart(2, "0")}.pdf`,
      );
    }

    return new Response("Tipo de relatório inválido.", { status: 400 });
  } catch (error) {
    logServerError("reports.finance", error);
    return new Response("Não foi possível gerar o relatório agora.", { status: 500 });
  }
}
