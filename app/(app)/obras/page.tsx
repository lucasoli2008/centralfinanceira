import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { getWorkSummary } from "@/server/queries/works";
import { resolveWorkFilters, WorksTableSection, type WorkListSearchParams } from "@/features/works/work-list-page";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";

export const metadata: Metadata = { title: "Obras" };

export default async function ObrasPage({ searchParams }: { searchParams: Promise<WorkListSearchParams> }) {
  const params = await searchParams;
  const { filters, periodLabel } = resolveWorkFilters(params);
  const summary = await getWorkSummary(filters);

  return (
    <>
      <PageHeader
        title="Obras"
        description="Controle de reformas, reparos e manutenções nos imóveis administrados."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/obras/relatorios">
                <FileDown />
                Relatórios
              </Link>
            </Button>
            <Button asChild>
              <Link href="/obras/nova">
                <Plus />
                Nova obra
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total de obras" value={formatInteger(summary.total)} hint={periodLabel} emphasis />
        <MetricCard label="Em andamento" value={formatInteger(summary.emAndamento)} hint={periodLabel} />
        <MetricCard label="Concluídas" value={formatInteger(summary.concluidas)} hint={periodLabel} />
        <MetricCard label="Pausadas" value={formatInteger(summary.pausadas)} hint={periodLabel} />
        <MetricCard
          label="Gasto total"
          value={formatCurrency(summary.gastoTotalPeriodo)}
          hint={periodLabel}
          formula="Soma dos lançamentos (materiais + serviços + outros custos) das obras listadas, no período escolhido."
        />
      </div>

      <WorksTableSection searchParams={params} />
    </>
  );
}
