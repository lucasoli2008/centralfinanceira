import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import type { CommissionReceiptRow, FinYearCardRow } from "@/types/database";

/** Leituras da visão por mês (0013). Números vêm de fin_report_year_cards. */

export async function getYearCards(year: number): Promise<FinYearCardRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_year_cards", { p_year: year });
  if (error) {
    logServerError("finance.getYearCards", error);
    return Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      cash_in: 0,
      cash_out: 0,
      revenue: 0,
      expenses: 0,
      result: 0,
      closing_balance: 0,
      payables_count: 0,
      payables_amount: 0,
      receivables_count: 0,
      receivables_amount: 0,
      statement_pending: 0,
      is_closed: false,
    }));
  }
  return ((data ?? []) as FinYearCardRow[]).map((row) => ({
    ...row,
    month: Number(row.month),
    cash_in: Number(row.cash_in),
    cash_out: Number(row.cash_out),
    revenue: Number(row.revenue),
    expenses: Number(row.expenses),
    result: Number(row.result),
    closing_balance: Number(row.closing_balance),
    payables_count: Number(row.payables_count),
    payables_amount: Number(row.payables_amount),
    receivables_count: Number(row.receivables_count),
    receivables_amount: Number(row.receivables_amount),
    statement_pending: Number(row.statement_pending),
  }));
}

export interface MonthRecurringItem {
  entry_id: string;
  recurrence_id: string;
  description: string;
  kind: "income" | "expense";
  amount: number;
  remaining: number;
  due_date: string;
  status: string;
  value_mode: "fixed" | "variable";
  category_name: string | null;
  account_id: string | null;
}

/** Ocorrências de recorrências com vencimento no mês (contas fixas do mês). */
export async function listMonthRecurringItems(from: string, to: string): Promise<MonthRecurringItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_entries")
    .select(
      "id, recurrence_id, description, kind, amount, settled_amount, due_date, competence_date, status, account_id, fin_recurrences(value_mode), fin_categories(name)",
    )
    .not("recurrence_id", "is", null)
    .is("cancelled_at", null)
    .gte("competence_date", from)
    .lte("competence_date", to)
    .order("competence_date");
  if (error) {
    logServerError("finance.listMonthRecurringItems", error);
    return [];
  }
  type Row = {
    id: string;
    recurrence_id: string;
    description: string;
    kind: "income" | "expense";
    amount: number;
    settled_amount: number;
    due_date: string | null;
    competence_date: string;
    status: string;
    account_id: string | null;
    fin_recurrences: { value_mode: "fixed" | "variable" } | null;
    fin_categories: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    entry_id: row.id,
    recurrence_id: row.recurrence_id,
    description: row.description,
    kind: row.kind,
    amount: Number(row.amount),
    remaining: Number(row.amount) - Number(row.settled_amount),
    due_date: row.due_date ?? row.competence_date,
    status: row.status,
    value_mode: row.fin_recurrences?.value_mode ?? "fixed",
    category_name: row.fin_categories?.name ?? null,
    account_id: row.account_id,
  }));
}

/**
 * Status de recebimento das comissões (venda/locação) no caixa. Tolerante: sem o
 * módulo financeiro no banco, devolve null e a coluna "Recebido" não aparece.
 */
export async function getCommissionReceipts(entryIds: string[]): Promise<Map<string, CommissionReceiptRow> | null> {
  if (entryIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_commission_receipts", { p_entry_ids: entryIds });
  if (error) {
    if (!["42883", "PGRST202", "42P01"].includes((error as { code?: string }).code ?? "")) {
      logServerError("finance.getCommissionReceipts", error);
    }
    return null;
  }
  return new Map(
    ((data ?? []) as CommissionReceiptRow[]).map((row) => [
      row.entry_id,
      { ...row, received_on: String(row.received_on).slice(0, 10), gross_amount: Number(row.gross_amount) },
    ]),
  );
}
