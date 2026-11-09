import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import type {
  FinAccountBalanceRow,
  FinAccountRow,
  FinAttachmentRow,
  FinCategoryRow,
  FinCategoryTotalRow,
  FinCostCenterRow,
  FinCounterpartyRow,
  FinEntryDetailRow,
  FinEntryKind,
  FinEntryStatus,
  FinMonthlyRow,
  FinNature,
  FinOperationRow,
  FinPropertyResultRow,
  FinPropertyRow,
  FinRegime,
  FinSettlementRow,
  FinSummaryRow,
} from "@/types/database";

/**
 * Leituras do Controle Financeiro. Todos os totais vêm das funções SQL
 * fin_report_* (0010_finance_core.sql) — nenhuma tela soma por conta própria.
 */

export interface FinReportFilters {
  from: string;
  to: string;
  regime: FinRegime;
  accountId?: string | null;
  categoryId?: string | null;
  nature?: FinNature | null;
}

const NUMERIC_SUMMARY_KEYS: (keyof FinSummaryRow)[] = [
  "cash_balance",
  "cash_in",
  "cash_out",
  "own_revenue",
  "other_revenue",
  "deductions",
  "direct_costs",
  "operating_expenses",
  "other_expenses",
  "net_result",
  "partner_withdrawals",
  "receivables_open",
  "receivables_overdue",
  "payables_open",
  "payables_overdue",
  "third_party_obligations",
  "deposits_held",
  "broker_payouts_pending",
  "commissions_not_in_cash",
  "commissions_not_in_cash_count",
  "own_available",
  "forecast_30_balance",
];

export const EMPTY_FIN_SUMMARY: FinSummaryRow = Object.fromEntries(
  NUMERIC_SUMMARY_KEYS.map((key) => [key, 0]),
) as unknown as FinSummaryRow;

function toNumbers<T extends object>(row: T, keys: (keyof T)[]): T {
  const copy = { ...row };
  for (const key of keys) copy[key] = Number(copy[key] ?? 0) as T[keyof T];
  return copy;
}

function reportParams(filters: FinReportFilters) {
  return {
    p_from: filters.from,
    p_to: filters.to,
    p_regime: filters.regime,
    p_account_id: filters.accountId || null,
    p_category_id: filters.categoryId || null,
    p_nature: filters.nature || null,
  };
}

export async function getFinSummary(filters: FinReportFilters): Promise<FinSummaryRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_summary", reportParams(filters));
  if (error) {
    logServerError("finance.getFinSummary", error);
    return EMPTY_FIN_SUMMARY;
  }
  const row = (data as FinSummaryRow[] | null)?.[0];
  return row ? toNumbers(row, NUMERIC_SUMMARY_KEYS) : EMPTY_FIN_SUMMARY;
}

export async function getFinMonthly(filters: FinReportFilters): Promise<FinMonthlyRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_monthly", reportParams(filters));
  if (error) {
    logServerError("finance.getFinMonthly", error);
    return [];
  }
  return ((data ?? []) as FinMonthlyRow[]).map((row) =>
    toNumbers(row, [
      "revenue",
      "expenses",
      "result",
      "cash_in",
      "cash_out",
      "closing_balance",
      "planned_in",
      "planned_out",
    ]),
  );
}

export async function getFinByCategory(
  filters: FinReportFilters,
  kind: "income" | "expense",
): Promise<FinCategoryTotalRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_by_category", {
    p_from: filters.from,
    p_to: filters.to,
    p_regime: filters.regime,
    p_kind: kind,
    p_account_id: filters.accountId || null,
  });
  if (error) {
    logServerError("finance.getFinByCategory", error);
    return [];
  }
  return ((data ?? []) as FinCategoryTotalRow[]).map((row) => toNumbers(row, ["total", "items_count"]));
}

export async function getFinAccountBalances(date?: string): Promise<FinAccountBalanceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_account_balances", { p_date: date ?? null });
  if (error) {
    logServerError("finance.getFinAccountBalances", error);
    return [];
  }
  return ((data ?? []) as FinAccountBalanceRow[]).map((row) => toNumbers(row, ["balance"]));
}

export async function getFinPropertyResults(from: string, to: string): Promise<FinPropertyResultRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_report_properties", { p_from: from, p_to: to });
  if (error) {
    logServerError("finance.getFinPropertyResults", error);
    return [];
  }
  return ((data ?? []) as FinPropertyResultRow[]).map((row) =>
    toNumbers(row, ["rent_collected", "own_revenue", "owner_transferred", "owner_pending", "direct_expenses", "result"]),
  );
}

// -----------------------------------------------------------------------------
// Lançamentos
// -----------------------------------------------------------------------------

export type FinEntryView = "all" | "payables" | "receivables";

export interface FinEntryFilters {
  view?: FinEntryView;
  from?: string | null;
  to?: string | null;
  /** Campo de data filtrado: competência (lançamentos) ou vencimento (a pagar/receber). */
  dateField?: "competence_date" | "reference_date";
  kind?: FinEntryKind | null;
  status?: FinEntryStatus | "overdue" | "pending" | null;
  categoryId?: string | null;
  accountId?: string | null;
  counterpartyId?: string | null;
  nature?: FinNature | null;
  search?: string | null;
  operationId?: string | null;
  includeCancelled?: boolean;
}

const ENTRY_NUMERIC: (keyof FinEntryDetailRow)[] = ["amount", "settled_amount", "remaining_amount"];

export async function listFinEntries(
  filters: FinEntryFilters,
  { page = 1, pageSize = 50 }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: FinEntryDetailRow[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const offset = (page - 1) * pageSize;
  const dateField = filters.dateField ?? "competence_date";

  let query = supabase.from("fin_entries_detail").select("*", { count: "exact" });

  if (filters.view === "payables") query = query.eq("kind", "expense");
  if (filters.view === "receivables") query = query.eq("kind", "income");
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.from) query = query.gte(dateField, filters.from);
  if (filters.to) query = query.lte(dateField, filters.to);
  if (filters.accountId) query = query.or(`account_id.eq.${filters.accountId},transfer_account_id.eq.${filters.accountId}`);
  if (filters.counterpartyId) query = query.eq("counterparty_id", filters.counterpartyId);
  if (filters.operationId) query = query.eq("operation_id", filters.operationId);
  if (filters.nature) query = query.eq("nature", filters.nature);
  if (filters.categoryId) {
    query = query.or(`category_id.eq.${filters.categoryId},category_parent_id.eq.${filters.categoryId}`);
  }

  if (filters.status === "overdue") query = query.eq("is_overdue", true);
  else if (filters.status === "pending") query = query.in("status", ["forecast", "open", "partial"]);
  else if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.includeCancelled) query = query.neq("status", "cancelled");

  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim().replace(/[%,()]/g, "");
    query = query.or(
      `description.ilike.%${term}%,counterparty_name.ilike.%${term}%,document_number.ilike.%${term}%`,
    );
  }

  const ascending = filters.view === "payables" || filters.view === "receivables";
  const { data, error, count } = await query
    .order(dateField, { ascending })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    logServerError("finance.listFinEntries", error);
    return { rows: [], total: 0 };
  }

  return {
    rows: ((data ?? []) as FinEntryDetailRow[]).map((row) => toNumbers(row, ENTRY_NUMERIC)),
    total: count ?? 0,
  };
}

export interface FinEntryHistoryItem {
  id: number;
  action: string;
  entityType: string;
  createdAt: string;
  userName: string | null;
  reason: string | null;
  changes: string[];
}

export interface FinEntryDetail {
  entry: FinEntryDetailRow;
  settlements: (FinSettlementRow & { account_name: string | null })[];
  attachments: FinAttachmentRow[];
  history: FinEntryHistoryItem[];
  operation: FinOperationRow | null;
  related: FinEntryDetailRow[];
}

const TRACKED_FIELDS: Record<string, string> = {
  description: "descrição",
  amount: "valor",
  category_id: "categoria",
  account_id: "conta",
  counterparty_id: "favorecido",
  competence_date: "competência",
  due_date: "vencimento",
  status: "status",
  is_forecast: "previsão",
  notes: "observações",
  payment_method: "forma de pagamento",
  cost_center_id: "centro de custo",
};

export async function getFinEntryDetail(entryId: string): Promise<FinEntryDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: entry, error } = await supabase
    .from("fin_entries_detail")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();

  if (error || !entry) {
    if (error) logServerError("finance.getFinEntryDetail", error);
    return null;
  }

  const typedEntry = toNumbers(entry as FinEntryDetailRow, ENTRY_NUMERIC);

  const [{ data: settlements }, { data: attachments }, { data: operation }] = await Promise.all([
    supabase
      .from("fin_settlements")
      .select("*, fin_accounts(name)")
      .eq("entry_id", entryId)
      .order("settled_on", { ascending: true }),
    supabase
      .from("fin_attachments")
      .select("*")
      .eq("entry_id", entryId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    typedEntry.operation_id
      ? supabase.from("fin_operations").select("*").eq("id", typedEntry.operation_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const settlementRows = ((settlements ?? []) as (FinSettlementRow & { fin_accounts: { name: string } | null })[]).map(
    ({ fin_accounts, ...row }) => ({ ...row, amount: Number(row.amount), account_name: fin_accounts?.name ?? null }),
  );

  const entityIds = [entryId, ...settlementRows.map((row) => row.id)];
  const { data: logs } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, created_at, before_data, after_data, metadata, user_id")
    .in("entity_id", entityIds)
    .in("entity_type", ["fin_entries", "fin_settlements"])
    .order("created_at", { ascending: true })
    .limit(200);

  const userIds = Array.from(new Set((logs ?? []).map((log) => log.user_id).filter(Boolean))) as string[];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  const history: FinEntryHistoryItem[] = (logs ?? []).map((log) => {
    const before = (log.before_data ?? {}) as Record<string, unknown>;
    const after = (log.after_data ?? {}) as Record<string, unknown>;
    const changes =
      log.action === "update"
        ? Object.entries(TRACKED_FIELDS)
            .filter(([field]) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
            .map(([, label]) => label)
        : [];
    const metadata = (log.metadata ?? {}) as Record<string, unknown>;
    return {
      id: log.id as number,
      action: log.action as string,
      entityType: log.entity_type as string,
      createdAt: log.created_at as string,
      userName: log.user_id ? (names.get(log.user_id as string) ?? null) : null,
      reason: typeof metadata.justificativa === "string" ? metadata.justificativa : null,
      changes,
    };
  });

  let related: FinEntryDetailRow[] = [];
  if (typedEntry.operation_id || typedEntry.installment_group_id) {
    const column = typedEntry.operation_id ? "operation_id" : "installment_group_id";
    const value = typedEntry.operation_id ?? typedEntry.installment_group_id;
    const { data: relatedRows } = await supabase
      .from("fin_entries_detail")
      .select("*")
      .eq(column, value as string)
      .neq("id", entryId)
      .order("installment_number", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    related = ((relatedRows ?? []) as FinEntryDetailRow[]).map((row) => toNumbers(row, ENTRY_NUMERIC));
  }

  return {
    entry: typedEntry,
    settlements: settlementRows,
    attachments: (attachments ?? []) as FinAttachmentRow[],
    history,
    operation: (operation as FinOperationRow | null) ?? null,
    related,
  };
}

// -----------------------------------------------------------------------------
// Cadastros
// -----------------------------------------------------------------------------

export async function listFinAccounts(includeInactive = true): Promise<FinAccountRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("fin_accounts").select("*").order("is_active", { ascending: false }).order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) logServerError("finance.listFinAccounts", error);
  return ((data ?? []) as FinAccountRow[]).map((row) => toNumbers(row, ["opening_balance"]));
}

export async function listFinCategories(includeInactive = true): Promise<FinCategoryRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("fin_categories").select("*").order("sort_order").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) logServerError("finance.listFinCategories", error);
  return (data ?? []) as FinCategoryRow[];
}

export async function listFinCostCenters(includeInactive = true): Promise<FinCostCenterRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("fin_cost_centers").select("*").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) logServerError("finance.listFinCostCenters", error);
  return (data ?? []) as FinCostCenterRow[];
}

export async function listFinCounterparties(includeInactive = true): Promise<FinCounterpartyRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("fin_counterparties").select("*").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) logServerError("finance.listFinCounterparties", error);
  return (data ?? []) as FinCounterpartyRow[];
}

export async function listFinProperties(includeInactive = true): Promise<FinPropertyRow[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("fin_properties").select("*").order("label");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) logServerError("finance.listFinProperties", error);
  return ((data ?? []) as FinPropertyRow[]).map((row) => ({
    ...row,
    admin_fee_rate: row.admin_fee_rate === null ? null : Number(row.admin_fee_rate),
  }));
}

/** Tudo que os formulários de lançamento precisam, numa ida ao banco por tabela. */
export async function getFinLookups() {
  const [accounts, categories, costCenters, counterparties, properties] = await Promise.all([
    listFinAccounts(false),
    listFinCategories(false),
    listFinCostCenters(false),
    listFinCounterparties(false),
    listFinProperties(false),
  ]);
  return { accounts, categories, costCenters, counterparties, properties };
}

export type FinLookups = Awaited<ReturnType<typeof getFinLookups>>;

// -----------------------------------------------------------------------------
// Inteligência imobiliária
// -----------------------------------------------------------------------------

export async function listFinOperations(limit = 50): Promise<(FinOperationRow & { property_label: string | null; counterparty_name: string | null })[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fin_operations")
    .select("*, fin_properties(label), fin_counterparties(name)")
    .order("reference_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) logServerError("finance.listFinOperations", error);

  type Raw = FinOperationRow & { fin_properties: { label: string } | null; fin_counterparties: { name: string } | null };
  return ((data ?? []) as Raw[]).map(({ fin_properties, fin_counterparties, ...row }) => ({
    ...toNumbers(row, ["gross_amount", "own_amount", "third_party_amount"]),
    property_label: fin_properties?.label ?? null,
    counterparty_name: fin_counterparties?.name ?? null,
  }));
}

export interface PendingCommissionRow {
  entry_id: string;
  entry_type: "sale" | "rental";
  entry_date: string;
  description: string;
  base_amount: number;
  gross_commission: number;
  total_broker_payout: number;
  net_company_revenue: number;
  broker_names: string[] | null;
  exception_confirmed: boolean;
}

/** Comissões registradas no módulo de comissões que ainda não entraram no caixa. */
export async function listCommissionsNotInCash(limit = 100): Promise<PendingCommissionRow[]> {
  const supabase = await createSupabaseServerClient();

  const [{ data: commissions, error }, { data: operations }] = await Promise.all([
    supabase
      .from("financial_entry_totals")
      .select(
        "entry_id, entry_type, entry_date, description, base_amount, gross_commission, total_broker_payout, net_company_revenue, broker_names, exception_confirmed",
      )
      .is("deleted_at", null)
      .gt("gross_commission", 0)
      .order("entry_date", { ascending: false })
      .limit(500),
    supabase.from("fin_operations").select("commission_entry_id").is("cancelled_at", null).not("commission_entry_id", "is", null),
  ]);

  if (error) {
    logServerError("finance.listCommissionsNotInCash", error);
    return [];
  }

  const done = new Set((operations ?? []).map((row) => row.commission_entry_id as string));
  return ((commissions ?? []) as PendingCommissionRow[])
    .filter((row) => !done.has(row.entry_id))
    .slice(0, limit)
    .map((row) => toNumbers(row, ["base_amount", "gross_commission", "total_broker_payout", "net_company_revenue"]));
}

export async function getSignedFinAttachmentUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from("finance-attachments").createSignedUrl(storagePath, expiresInSeconds);
  if (error) {
    logServerError("finance.getSignedFinAttachmentUrl", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
