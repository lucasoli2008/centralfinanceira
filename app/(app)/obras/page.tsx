import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkMonthlySpending, getWorkSummary } from "@/server/queries/works";
import { resolveWorkFilters, WorksTableSection, type WorkListSearchParams } from "@/features/works/work-list-page";
import { WorkSpendingChart } from "@/features/works/work-spending-chart";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";

export const metadata: Metadata = { title: "Obras" };

export default async function ObrasPage({ searchParams }: { searchParams: Promise<WorkListSearchParams> }) {
  const params = await searchParams;
  const { filters, periodLabel } = resolveWorkFilters(params);
  const [summary, spending] = await Promise.all([getWorkSummary(filters), getWorkMonthlySpending(filters)]);

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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total de obras" value={formatInteger(summary.total)} hint={periodLabel} emphasis />
        <MetricCard label="Em andamento" value={formatInteger(summary.emAndamento)} hint={periodLabel} />
        <MetricCard label="Concluídas" value={formatInteger(summary.concluidas)} hint={periodLabel} />
        <MetricCard
          label="Atrasadas"
          value={formatInteger(summary.atrasadas)}
          hint={summary.atrasadas > 0 ? "Previsão vencida" : periodLabel}
          formula="Obras com previsão de conclusão anterior a hoje e ainda não concluídas nem canceladas."
          className={summary.atrasadas > 0 ? "border-danger/40" : undefined}
        />
        <MetricCard
          label="Gasto total"
          value={formatCurrency(summary.gastoTotalPeriodo)}
          hint={periodLabel}
          formula="Soma dos lançamentos (materiais + serviços + outros custos) das obras listadas, no período escolhido."
        />
        <MetricCard
          label="A pagar"
          value={formatCurrency(summary.aPagar)}
          hint={summary.aPagar > 0 ? "Itens ainda não pagos" : periodLabel}
          formula="Soma dos lançamentos marcados como não pagos, nas obras e no período listados."
          className={summary.aPagar > 0 ? "border-warning/40" : undefined}
        />
      </div>

      {spending.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <div>
              <CardTitle>Gastos por mês</CardTitle>
              <CardDescription>Materiais, serviços e outros custos pela data do lançamento — pago × a pagar.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <WorkSpendingChart series={spending} />
          </CardContent>
        </Card>
      ) : null}

      <WorksTableSection searchParams={params} />
    </>
  );
}
