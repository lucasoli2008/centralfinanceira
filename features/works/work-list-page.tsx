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

export async function WorkListPage({ searchParams }: { searchParams: WorkListSearchParams }) {
  const period = resolvePeriod(searchParams);
  const page = Math.max(1, Number(searchParams.pagina) || 1);

  const filters: WorkFilters = {
    from: period.from,
    to: period.to,
    status: (searchParams.status as WorkStatus) || null,
    category: (searchParams.categoria as WorkCategory) || null,
    search: searchParams.busca || null,
  };

  const [{ rows, total }, years] = await Promise.all([
    listWorks(filters, { page, pageSize: PAGE_SIZE }),
    listActiveWorkYears(),
  ]);

  const aggregates = Object.fromEntries(await getWorksAggregates(rows.map((row) => row.id)));

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

      <WorksTable rows={rows} aggregates={aggregates} years={years} page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}
