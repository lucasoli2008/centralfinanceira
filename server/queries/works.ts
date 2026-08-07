import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import { toDecimal, roundMoney } from "@/lib/finance/engine";
import type { WorkTotals } from "@/lib/works/types";
import type {
  WorkActivityRow,
  WorkAttachmentCategory,
  WorkAttachmentRow,
  WorkCategory,
  WorkEntryRow,
  WorkPriority,
  WorkRow,
  WorkStatus,
} from "@/types/database";

export interface WorkFilters {
  status?: WorkStatus | null;
  category?: WorkCategory | null;
  priority?: WorkPriority | null;
  responsibleName?: string | null;
  ownerLabel?: string | null;
  /** Intervalo aplicado à data de início da obra (started_at). */
  from?: string | null;
  to?: string | null;
  /** Busca livre em título, imóvel, endereço e proprietário. */
  search?: string | null;
  includeArchived?: boolean;
}

const WORK_COLUMNS = "*";

function buildWorksQuery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  filters: WorkFilters,
  options: { count?: "exact"; columns?: string } = {},
) {
  let query = supabase
    .from("works")
    .select(options.columns ?? WORK_COLUMNS, options.count ? { count: options.count } : undefined);

  if (!filters.includeArchived) query = query.eq("is_archived", false);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.responsibleName) query = query.ilike("responsible_name", `%${filters.responsibleName}%`);
  if (filters.ownerLabel) query = query.ilike("owner_label", `%${filters.ownerLabel}%`);
  if (filters.from) query = query.gte("started_at", filters.from);
  if (filters.to) query = query.lte("started_at", filters.to);

  if (filters.search && filters.search.trim() !== "") {
    const term = filters.search.trim().replace(/[%,]/g, "");
    query = query.or(
      `title.ilike.%${term}%,property_label.ilike.%${term}%,address.ilike.%${term}%,owner_label.ilike.%${term}%`,
    );
  }

  return query;
}

/** Lista de obras com paginação, para a tela /obras/lista. */
export async function listWorks(
  filters: WorkFilters,
  { page = 1, pageSize = 25, sortBy = "updated_at", sortDirection = "desc" }: {
    page?: number;
    pageSize?: number;
    sortBy?: "updated_at" | "started_at" | "title";
    sortDirection?: "asc" | "desc";
  } = {},
): Promise<{ rows: WorkRow[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const offset = (page - 1) * pageSize;

  const { data, error, count } = await buildWorksQuery(supabase, filters, { count: "exact" })
    .order(sortBy, { ascending: sortDirection === "asc" })
    .range(offset, offset + pageSize - 1);

  if (error) {
    logServerError("queries.listWorks", error);
    return { rows: [], total: 0 };
  }

  return { rows: (data ?? []) as unknown as WorkRow[], total: count ?? (data?.length ?? 0) };
}

/** Todas as obras do filtro, sem paginação (relatórios gerais em PDF/CSV). */
export async function listAllWorks(filters: WorkFilters): Promise<WorkRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await buildWorksQuery(supabase, filters).order("started_at", {
    ascending: false,
  });

  if (error) {
    logServerError("queries.listAllWorks", error);
    return [];
  }

  return (data ?? []) as unknown as WorkRow[];
}

/** Anos com obras cadastradas, para o seletor de mês específico do filtro de período. */
export async function listActiveWorkYears(): Promise<number[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.from("works").select("started_at").not("started_at", "is", null);

  const years = Array.from(
    new Set((data ?? []).map((row) => Number(String(row.started_at).slice(0, 4)))),
  );
  const currentYear = new Date().getFullYear();

  if (!years.includes(currentYear)) years.unshift(currentYear);
  return years.sort((a, b) => b - a);
}

export async function getWork(workId: string): Promise<WorkRow | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("works").select("*").eq("id", workId).maybeSingle();

  if (error) {
    logServerError("queries.getWork", error);
    return null;
  }

  return (data as WorkRow | null) ?? null;
}

export async function getWorkByCode(code: string): Promise<WorkRow | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.from("works").select("*").eq("code", code).maybeSingle();

  return (data as WorkRow | null) ?? null;
}

export interface WorkDashboardSummary {
  total: number;
  emAndamento: number;
  concluidas: number;
  pausadas: number;
  gastoTotalPeriodo: number;
}

/** Cards do dashboard. Contagens por status + gasto total no período (entry_date). */
export async function getWorkSummary(filters: WorkFilters): Promise<WorkDashboardSummary> {
  const supabase = await createSupabaseServerClient();

  const { data: works, error } = await buildWorksQuery(supabase, filters, { columns: "id, status" });

  if (error) {
    logServerError("queries.getWorkSummary", error);
    return { total: 0, emAndamento: 0, concluidas: 0, pausadas: 0, gastoTotalPeriodo: 0 };
  }

  const rows = (works ?? []) as unknown as Pick<WorkRow, "id" | "status">[];
  const workIds = rows.map((row) => row.id);

  let gastoTotalPeriodo = 0;
  if (workIds.length > 0) {
    let entriesQuery = supabase
      .from("work_entries")
      .select("total_amount")
      .in("work_id", workIds)
      .is("deleted_at", null);

    if (filters.from) entriesQuery = entriesQuery.gte("entry_date", filters.from);
    if (filters.to) entriesQuery = entriesQuery.lte("entry_date", filters.to);

    const { data: entries, error: entriesError } = await entriesQuery;
    if (entriesError) {
      logServerError("queries.getWorkSummary.entries", entriesError);
    } else {
      gastoTotalPeriodo = roundMoney(
        (entries ?? []).reduce((total, entry) => total.plus(toDecimal(entry.total_amount)), toDecimal(0)),
      );
    }
  }

  return {
    total: rows.length,
    emAndamento: rows.filter((row) => row.status === "em_andamento").length,
    concluidas: rows.filter((row) => row.status === "concluida").length,
    pausadas: rows.filter((row) => row.status === "pausada").length,
    gastoTotalPeriodo,
  };
}

/** Obras mais recentemente atualizadas, para o dashboard. */
export async function listRecentWorks(limit = 5): Promise<WorkRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("works")
    .select("*")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    logServerError("queries.listRecentWorks", error);
    return [];
  }

  return (data ?? []) as WorkRow[];
}

export interface WorkAggregate {
  totalAmount: number;
  attachmentsCount: number;
}

/**
 * Total gasto e quantidade de anexos por obra, em duas consultas para a
 * página inteira (nunca uma consulta por linha da tabela).
 */
export async function getWorksAggregates(workIds: string[]): Promise<Map<string, WorkAggregate>> {
  const aggregates = new Map<string, WorkAggregate>();
  if (workIds.length === 0) return aggregates;

  const supabase = await createSupabaseServerClient();

  const [{ data: entries, error: entriesError }, { data: attachments, error: attachmentsError }] =
    await Promise.all([
      supabase.from("work_entries").select("work_id, total_amount").in("work_id", workIds).is("deleted_at", null),
      supabase.from("work_attachments").select("work_id").in("work_id", workIds).is("deleted_at", null),
    ]);

  if (entriesError) logServerError("queries.getWorksAggregates.entries", entriesError);
  if (attachmentsError) logServerError("queries.getWorksAggregates.attachments", attachmentsError);

  for (const workId of workIds) aggregates.set(workId, { totalAmount: 0, attachmentsCount: 0 });

  const totalsByWork = new Map<string, ReturnType<typeof toDecimal>>();
  for (const entry of entries ?? []) {
    const workId = entry.work_id as string;
    totalsByWork.set(workId, (totalsByWork.get(workId) ?? toDecimal(0)).plus(toDecimal(entry.total_amount)));
  }
  for (const [workId, total] of totalsByWork) {
    aggregates.set(workId, { ...aggregates.get(workId)!, totalAmount: roundMoney(total) });
  }

  for (const attachment of attachments ?? []) {
    const workId = attachment.work_id as string;
    const current = aggregates.get(workId);
    if (current) current.attachmentsCount += 1;
  }

  return aggregates;
}

export async function listWorkEntries(workId: string): Promise<WorkEntryRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("work_entries")
    .select("*")
    .eq("work_id", workId)
    .is("deleted_at", null)
    .order("entry_date", { ascending: false });

  if (error) {
    logServerError("queries.listWorkEntries", error);
    return [];
  }

  return (data ?? []) as WorkEntryRow[];
}

/** Totais de materiais/serviços/outros custos, sempre somados a partir dos lançamentos reais. */
export async function getWorkEntryTotals(workId: string): Promise<WorkTotals> {
  const entries = await listWorkEntries(workId);

  const sumByType = (type: WorkEntryRow["entry_type"]) =>
    roundMoney(
      entries
        .filter((entry) => entry.entry_type === type)
        .reduce((total, entry) => total.plus(toDecimal(entry.total_amount)), toDecimal(0)),
    );

  const materialsTotal = sumByType("material");
  const servicesTotal = sumByType("servico");
  const otherTotal = sumByType("outro_custo");

  return {
    materialsTotal,
    servicesTotal,
    otherTotal,
    grandTotal: roundMoney(toDecimal(materialsTotal).plus(servicesTotal).plus(otherTotal)),
  };
}

export async function listWorkAttachments(
  workId: string,
  category?: WorkAttachmentCategory,
): Promise<WorkAttachmentRow[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase.from("work_attachments").select("*").eq("work_id", workId).is("deleted_at", null);
  if (category) query = query.eq("category", category);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logServerError("queries.listWorkAttachments", error);
    return [];
  }

  return (data ?? []) as WorkAttachmentRow[];
}

export async function listWorkActivities(workId: string): Promise<WorkActivityRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("work_activities")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });

  if (error) {
    logServerError("queries.listWorkActivities", error);
    return [];
  }

  return (data ?? []) as WorkActivityRow[];
}

/** Nomes de fornecedor/prestador já usados, para o autocomplete de texto livre. */
export async function listRecentSuppliers(limit = 20): Promise<string[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("work_entries")
    .select("supplier_name")
    .not("supplier_name", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    logServerError("queries.listRecentSuppliers", error);
    return [];
  }

  const names = (data ?? [])
    .map((row) => (row.supplier_name as string | null)?.trim())
    .filter((name): name is string => Boolean(name));

  return Array.from(new Set(names)).slice(0, limit);
}

/** URL assinada de um anexo, gerada sob demanda (nunca armazenada). */
export async function getSignedAttachmentUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage
    .from("work-attachments")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    logServerError("queries.getSignedAttachmentUrl", error);
    return null;
  }

  return data?.signedUrl ?? null;
}

export interface WorkMonthlySpending {
  periodKey: string;
  total: number;
}

/** Gastos por mês (soma de work_entries.total_amount), para o gráfico opcional do dashboard. */
export async function getWorkMonthlySpending(filters: WorkFilters): Promise<WorkMonthlySpending[]> {
  const supabase = await createSupabaseServerClient();

  const { data: works, error } = await buildWorksQuery(supabase, filters, { columns: "id" });
  if (error) {
    logServerError("queries.getWorkMonthlySpending", error);
    return [];
  }

  const workIds = ((works ?? []) as unknown as { id: string }[]).map((row) => row.id);
  if (workIds.length === 0) return [];

  const { data: entries, error: entriesError } = await supabase
    .from("work_entries")
    .select("entry_date, total_amount")
    .in("work_id", workIds)
    .is("deleted_at", null);

  if (entriesError) {
    logServerError("queries.getWorkMonthlySpending.entries", entriesError);
    return [];
  }

  const totalsByMonth = new Map<string, ReturnType<typeof toDecimal>>();
  for (const entry of entries ?? []) {
    const periodKey = String(entry.entry_date).slice(0, 7); // YYYY-MM
    const current = totalsByMonth.get(periodKey) ?? toDecimal(0);
    totalsByMonth.set(periodKey, current.plus(toDecimal(entry.total_amount)));
  }

  return Array.from(totalsByMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodKey, total]) => ({ periodKey, total: roundMoney(total) }));
}
