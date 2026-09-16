import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { WorksTable } from "./works-table";
import { getWorksAggregates, listActiveWorkYears, listWorks, type WorkFilters } from "@/server/queries/works";
import { resolvePeriod } from "@/lib/period";
import type { WorkCategory, WorkStatus } from "@/types/database";

export interface WorkListSearchParams {
  periodo?: string;
  de?: string;
  ate?: string;
  ano?: string;
  mes?: string;
  busca?: string;
  status?: string;
  categoria?: string;
  pagina?: string;
}

const PAGE_SIZE = 25;

/**
 * Traduz a URL nos filtros de obras. O período é opcional: sem `periodo` na
 * URL, nenhuma data é aplicada — obras planejadas não têm data de início e
 * sumiriam de um "este mês" implícito.
 */
export function resolveWorkFilters(searchParams: WorkListSearchParams): {
  filters: WorkFilters;
  periodLabel: string;
} {
  const period = searchParams.periodo ? resolvePeriod(searchParams) : null;

  return {
    filters: {
      from: period?.from ?? null,
      to: period?.to ?? null,
      status: (searchParams.status as WorkStatus) || null,
      category: (searchParams.categoria as WorkCategory) || null,
      search: searchParams.busca || null,
    },
    periodLabel: period?.label ?? "Todo o período",
  };
}

/** Tabela paginada de obras com filtros — usada no dashboard e em /obras/lista. */
export async function WorksTableSection({ searchParams }: { searchParams: WorkListSearchParams }) {
  const { filters } = resolveWorkFilters(searchParams);
  const page = Math.max(1, Number(searchParams.pagina) || 1);

  const [{ rows, total }, years] = await Promise.all([
    listWorks(filters, { page, pageSize: PAGE_SIZE }),
    listActiveWorkYears(),
  ]);

  const aggregates = Object.fromEntries(await getWorksAggregates(rows.map((row) => row.id)));

  return (
    <WorksTable rows={rows} aggregates={aggregates} years={years} page={page} pageSize={PAGE_SIZE} total={total} />
  );
}

export function WorkListPage({ searchParams }: { searchParams: WorkListSearchParams }) {
  return (
    <>
      <PageHeader
        title="Todas as obras"
        description="Busque, filtre e acompanhe cada obra cadastrada."
        backHref="/obras"
        backLabel="Dashboard de obras"
        actions={
          <Button asChild>
            <Link href="/obras/nova">
              <Plus />
              Nova obra
            </Link>
          </Button>
        }
      />

      <WorksTableSection searchParams={searchParams} />
    </>
  );
}
