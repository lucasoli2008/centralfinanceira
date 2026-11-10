import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import { buildDre, monthsBetween, type DreSourceRow, type DreStatement } from "@/lib/finance/dre";
import type {
  FinCashProjectionRow,
  FinCloseCheckRow,
  FinInsightRow,
  FinPeriodCloseRow,
  FinRegime,
} from "@/types/database";

/**
 * Leituras da Fase 3. DRE, projeção, checklist e alertas vêm das funções SQL
 * da migração 0012 — a tela e os relatórios só exibem.
 */

const toDate = (value: unknown) =>
  value === null || value === undefined ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export async function getDre(from: string, to: string, regime: FinRegime): Promise<DreStatement> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_dre", { p_from: from, p_to: to, p_regime: regime });
  if (error) logServerError("finance.getDre", error);
  const rows = ((data ?? []) as DreSourceRow[]).map((row) => ({ ...row, amount: Number(row.amount) }));
  return buildDre(rows, monthsBetween(from, to));
}

export async function getCashProjection(
  days: number,
  bucket: "day" | "week" | "month",
  includeForecasts = true,
): Promise<FinCashProjectionRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_cash_projection", {
    p_days: days,
    p_bucket: bucket,
    p_include_forecasts: includeForecasts,
  });
  if (error) {
    logServerError("finance.getCashProjection", error);
    return [];
  }
  return ((data ?? []) as FinCashProjectionRow[]).map((row) => ({
    bucket_start: toDate(row.bucket_start),
    bucket_end: toDate(row.bucket_end),
    inflow: Number(row.inflow),
    outflow: Number(row.outflow),
    third_party_out: Number(row.third_party_out),
    forecast_in: Number(row.forecast_in),
    forecast_out: Number(row.forecast_out),
    opening_balance: Number(row.opening_balance),
    closing_balance: Number(row.closing_balance),
  }));
}

export async function listPeriodCloses(year: number): Promise<(FinPeriodCloseRow & { closed_by_name: string | null })[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_period_closes")
    .select("*, closer:profiles!fin_period_closes_closed_by_fkey(full_name)")
    .eq("year", year)
    .order("month")
    .order("closed_at", { ascending: false });
  if (error) {
    logServerError("finance.listPeriodCloses", error);
    return [];
  }
  type Raw = FinPeriodCloseRow & { closer: { full_name: string | null } | null };
  return ((data ?? []) as Raw[]).map(({ closer, ...row }) => ({ ...row, closed_by_name: closer?.full_name ?? null }));
}

export async function getCloseChecklist(year: number, month: number): Promise<FinCloseCheckRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_close_checklist", { p_year: year, p_month: month });
  if (error) {
    logServerError("finance.getCloseChecklist", error);
    return [];
  }
  return ((data ?? []) as FinCloseCheckRow[]).map((row) => ({ ...row, quantity: Number(row.quantity), amount: Number(row.amount) }));
}

export async function getFinInsights(): Promise<FinInsightRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_insights");
  if (error) {
    logServerError("finance.getFinInsights", error);
    return [];
  }
  const order = { critical: 0, warning: 1, info: 2, positive: 3 } as const;
  return ((data ?? []) as FinInsightRow[])
    .map((row) => ({ ...row, metric: row.metric === null ? null : Number(row.metric) }))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
