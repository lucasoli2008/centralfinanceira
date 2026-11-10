import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import type {
  FinAccountMovementRow,
  FinBankImportRow,
  FinLineCandidateRow,
  FinReconciliationSummaryRow,
  FinRecurrenceRow,
  FinRuleRow,
  FinStatementLineListRow,
  FinStatementLineStatus,
} from "@/types/database";

/**
 * Leituras da Fase 2 (conciliação bancária e automação). Sugestões e saldos vêm
 * das funções SQL da migração 0011 — a tela não decide pares nem soma valores.
 */

function numbers<T extends object>(row: T, keys: (keyof T)[]): T {
  const copy = { ...row };
  for (const key of keys) {
    const value = copy[key];
    copy[key] = (value === null || value === undefined ? value : Number(value)) as T[keyof T];
  }
  return copy;
}

export const EMPTY_RECONCILIATION_SUMMARY: FinReconciliationSummaryRow = {
  ledger_balance: 0,
  statement_balance: null,
  statement_balance_date: null,
  ledger_balance_at_statement: null,
  difference: null,
  pending_lines: 0,
  pending_in: 0,
  pending_out: 0,
  matched_lines: 0,
  ignored_lines: 0,
  first_line_date: null,
  last_line_date: null,
  unmatched_movements: 0,
  suggestions: 0,
  last_import_at: null,
};

export async function getReconciliationSummary(accountId: string): Promise<FinReconciliationSummaryRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_reconciliation_summary", { p_account_id: accountId });
  if (error) {
    logServerError("finance.getReconciliationSummary", error);
    return EMPTY_RECONCILIATION_SUMMARY;
  }
  const row = (data as FinReconciliationSummaryRow[] | null)?.[0];
  if (!row) return EMPTY_RECONCILIATION_SUMMARY;
  return numbers(row, [
    "ledger_balance",
    "statement_balance",
    "ledger_balance_at_statement",
    "difference",
    "pending_lines",
    "pending_in",
    "pending_out",
    "matched_lines",
    "ignored_lines",
    "unmatched_movements",
    "suggestions",
  ]);
}

export async function listStatementLines(
  accountId: string,
  status: FinStatementLineStatus | "all",
): Promise<FinStatementLineListRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_statement_lines_list", { p_account_id: accountId, p_status: status });
  if (error) {
    logServerError("finance.listStatementLines", error);
    return [];
  }
  return ((data ?? []) as FinStatementLineListRow[]).map((row) => numbers(row, ["amount", "suggested_day_diff"]));
}

export async function getLineCandidates(lineId: string): Promise<FinLineCandidateRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_line_candidates", { p_line_id: lineId });
  if (error) {
    logServerError("finance.getLineCandidates", error);
    return [];
  }
  return ((data ?? []) as FinLineCandidateRow[]).map((row) => numbers(row, ["amount", "remaining", "day_diff"]));
}

/** Movimentos do sistema no período do extrato que ainda não têm linha correspondente. */
export async function listUnmatchedMovements(accountId: string, from: string | null, to: string | null): Promise<FinAccountMovementRow[]> {
  if (!from || !to) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("fin_account_movements", { p_account_id: accountId })
    .is("matched_line_id", null)
    .gte("movement_date", from)
    .lte("movement_date", to)
    .order("movement_date", { ascending: false })
    .limit(200);
  if (error) {
    logServerError("finance.listUnmatchedMovements", error);
    return [];
  }
  return ((data ?? []) as FinAccountMovementRow[]).map((row) => numbers(row, ["signed_amount"]));
}

export async function listBankImports(accountId: string, limit = 10): Promise<FinBankImportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_bank_imports")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) logServerError("finance.listBankImports", error);
  return ((data ?? []) as FinBankImportRow[]).map((row) => numbers(row, ["statement_balance"]));
}

export async function listFinRules(): Promise<FinRuleRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_rules")
    .select("*")
    .order("is_active", { ascending: false })
    .order("priority")
    .order("created_at");
  if (error) logServerError("finance.listFinRules", error);
  return ((data ?? []) as FinRuleRow[]).map((row) => numbers(row, ["amount_min", "amount_max"]));
}

export async function listFinRecurrences(): Promise<FinRecurrenceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_recurrences")
    .select("*")
    .order("is_active", { ascending: false })
    .order("description");
  if (error) logServerError("finance.listFinRecurrences", error);
  return ((data ?? []) as FinRecurrenceRow[]).map((row) => numbers(row, ["amount"]));
}

/** Próximas previsões geradas por cada recorrência (para mostrar na lista). */
export async function listUpcomingRecurrenceForecasts(limit = 200) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_entries")
    .select("id, recurrence_id, competence_date, amount, status")
    .not("recurrence_id", "is", null)
    .is("cancelled_at", null)
    .in("status", ["forecast", "open", "partial"])
    .order("competence_date")
    .limit(limit);
  if (error) logServerError("finance.listUpcomingRecurrenceForecasts", error);
  return ((data ?? []) as { id: string; recurrence_id: string; competence_date: string; amount: number; status: string }[]).map(
    (row) => ({ ...row, amount: Number(row.amount) }),
  );
}
