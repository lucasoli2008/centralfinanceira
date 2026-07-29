import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import type {
  AmountMode,
  EntryType,
  PropertyType,
} from "@/lib/finance/types";
import type {
  BrokerRankingRow,
  BrokerStatementRow,
  EntryTotalsRow,
  MonthlyClosingRow,
  MonthlySeriesRow,
  SplitAmountRow,
  SummaryRow,
} from "@/types/database";

export interface EntryFilters {
  from?: string | null;
  to?: string | null;
  entryType?: EntryType | null;
  brokerId?: string | null;
  propertyType?: PropertyType | null;
  commissionMode?: AmountMode | null;
  search?: string | null;
  onlyDeleted?: boolean;
}

function rpcParams(filters: EntryFilters) {
  return {
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_entry_type: filters.entryType ?? null,
    p_broker_id: filters.brokerId ?? null,
    p_property_type: filters.propertyType ?? null,
    p_commission_mode: filters.commissionMode ?? null,
    p_search: filters.search ?? null,
  };
}

const EMPTY_SUMMARY: SummaryRow = {
  total_gross_commission: 0,
  total_broker_payout: 0,
  total_net_revenue: 0,
  entries_count: 0,
  sales_count: 0,
  rental_count: 0,
  sales_base_amount: 0,
  sales_gross_commission: 0,
  sales_net_revenue: 0,
  rental_base_amount: 0,
  rental_gross_commission: 0,
  rental_net_revenue: 0,
  average_gross_commission: null,
  net_margin: null,
  weighted_sale_commission_rate: null,
  average_broker_payout_rate: null,
};

/** Lista de lançamentos com paginação. Fonte: report_entries. */
export async function listEntries(
  filters: EntryFilters,
  { page = 1, pageSize = 25 }: { page?: number; pageSize?: number } = {},
): Promise<{ rows: EntryTotalsRow[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .rpc("report_entries", { ...rpcParams(filters), p_only_deleted: filters.onlyDeleted ?? false }, {
      count: "exact",
    })
    .range(offset, offset + pageSize - 1);

  if (error) {
    logServerError("queries.listEntries", error);
    return { rows: [], total: 0 };
  }

  return { rows: (data ?? []) as EntryTotalsRow[], total: count ?? (data?.length ?? 0) };
}

/** Todos os lançamentos do filtro, sem paginação (relatórios e PDFs). */
export async function listAllEntries(filters: EntryFilters): Promise<EntryTotalsRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("report_entries", {
    ...rpcParams(filters),
    p_only_deleted: filters.onlyDeleted ?? false,
  });

  if (error) {
    logServerError("queries.listAllEntries", error);
    return [];
  }

  return (data ?? []) as EntryTotalsRow[];
}

export async function getSummary(filters: EntryFilters): Promise<SummaryRow> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("report_summary", rpcParams(filters));

  if (error) {
    logServerError("queries.getSummary", error);
    return EMPTY_SUMMARY;
  }

  const row = (data as SummaryRow[] | null)?.[0];
  return row ?? EMPTY_SUMMARY;
}

export async function getMonthlySeries(
  from: string,
  to: string,
  filters: Omit<EntryFilters, "from" | "to"> = {},
): Promise<MonthlySeriesRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("report_monthly_series", {
    ...rpcParams({ ...filters, from, to }),
  });

  if (error) {
    logServerError("queries.getMonthlySeries", error);
    return [];
  }

  return (data ?? []) as MonthlySeriesRow[];
}

export async function getBrokerRanking(filters: EntryFilters): Promise<BrokerRankingRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("report_broker_ranking", rpcParams(filters));

  if (error) {
    logServerError("queries.getBrokerRanking", error);
    return [];
  }

  return (data ?? []) as BrokerRankingRow[];
}

export async function getBrokerStatement(
  brokerId: string,
  from: string | null,
  to: string | null,
): Promise<BrokerStatementRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("report_broker_statement", {
    p_broker_id: brokerId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    logServerError("queries.getBrokerStatement", error);
    return [];
  }

  return (data ?? []) as BrokerStatementRow[];
}

export interface EntryDetail {
  entry: EntryTotalsRow;
  splits: SplitAmountRow[];
  createdByName: string | null;
  updatedByName: string | null;
}

export async function getEntryDetail(entryId: string): Promise<EntryDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: entry, error } = await supabase
    .from("financial_entry_totals")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  if (error || !entry) {
    if (error) logServerError("queries.getEntryDetail", error);
    return null;
  }

  const typedEntry = entry as EntryTotalsRow;

  const { data: splits } = await supabase
    .from("entry_split_amounts")
    .select("*")
    .eq("entry_id", entryId)
    .is("deleted_at", null)
    .order("broker_name");

  const authorIds = [typedEntry.created_by, typedEntry.updated_by].filter(Boolean) as string[];
  const { data: profiles } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
    : { data: [] };

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  return {
    entry: typedEntry,
    splits: (splits ?? []) as SplitAmountRow[],
    createdByName: typedEntry.created_by ? (nameById.get(typedEntry.created_by) ?? null) : null,
    updatedByName: typedEntry.updated_by ? (nameById.get(typedEntry.updated_by) ?? null) : null,
  };
}

/** Nome de quem criou cada lançamento, para a coluna "Criado por". */
export async function getEntryAuthors(entries: EntryTotalsRow[]): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(entries.map((entry) => entry.created_by).filter((id): id is string => Boolean(id))),
  );

  if (ids.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);

  return new Map(
    (data ?? []).map((profile) => [profile.id, profile.full_name ?? "—"] as [string, string]),
  );
}

export async function getMonthClosing(
  year: number,
  month: number,
): Promise<MonthlyClosingRow | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("monthly_closings")
    .select("*")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  return (data as MonthlyClosingRow | null) ?? null;
}

export async function listYearClosings(year: number): Promise<MonthlyClosingRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.from("monthly_closings").select("*").eq("year", year);

  return (data ?? []) as MonthlyClosingRow[];
}

/** Anos com movimento, para navegação da visão anual. */
export async function listActiveYears(): Promise<number[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("monthly_financial_summary")
    .select("year")
    .order("year", { ascending: false });

  const years = Array.from(new Set((data ?? []).map((row) => row.year as number)));
  const currentYear = new Date().getFullYear();

  if (!years.includes(currentYear)) years.unshift(currentYear);
  return years.sort((a, b) => b - a);
}
