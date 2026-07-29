import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { requireAppContext } from "@/lib/auth/session";
import { getMonthlySeries, getSummary, listActiveYears, listYearClosings } from "@/server/queries/entries";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";
import { monthName } from "@/lib/formatting/date";

export const metadata: Metadata = { title: "Meses" };

export default async function MesesPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  await requireAppContext();
  const { ano } = await searchParams;

  const years = await listActiveYears();
  const year = Number(ano) || years[0] || new Date().getFullYear();

  const [series, summary, closings] = await Promise.all([
    getMonthlySeries(`${year}-01-01`, `${year}-12-31`),
    getSummary({ from: `${year}-01-01`, to: `${year}-12-31` }),
    listYearClosings(year),
  ]);

  const closedMonths = new Set(
    closings.filter((closing) => closing.status === "closed").map((closing) => closing.month),
  );

  return (
    <>
      <PageHeader
        title={`Ano de ${year}`}
        description="Visão anual dos 12 meses. Clique em um mês para abrir a visão detalhada."
        actions={
          <div className="flex flex-wrap gap-2">
            {years.slice(0, 5).map((option) => (
              <Button
                key={option}
                asChild
                variant={option === year ? "primary" : "secondary"}
                size="sm"
              >
                <Link href={`/meses?ano=${option}`}>{option}</Link>
              </Button>
            ))}
            <Button asChild variant="secondary" size="sm">
              <a
                href={`/api/relatorios/anual?ano=${year}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                PDF anual
              </a>
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receita líquida do ano"
          value={formatCurrency(summary.total_net_revenue)}
          emphasis
        />
        <MetricCard
          label="Comissão bruta do ano"
          value={formatCurrency(summary.total_gross_commission)}
        />
        <MetricCard
          label="Repassado aos corretores"
          value={formatCurrency(summary.total_broker_payout)}
        />
        <MetricCard
          label="Entradas no ano"
          value={formatInteger(summary.entries_count)}
          hint={`${formatInteger(summary.sales_count)} vendas · ${formatInteger(
            summary.rental_count,
          )} locações`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
          const row = series.find((item) => item.month === month);
          const isClosed = closedMonths.has(month);

          return (
            <Link
              key={month}
              href={`/meses/${year}/${month}`}
              className="surface-card p-4 transition-colors hover:border-accent-border"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium">{monthName(month)}</p>
                {isClosed ? (
                  <Badge tone="warning">
                    <Lock className="size-2.5" />
                    Fechado
                  </Badge>
                ) : null}
              </div>

              <p className="mt-2 metric-value">{formatCurrency(row?.total_net_revenue ?? 0)}</p>
              <p className="text-xs text-subtle">Receita líquida</p>

              <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
                <div className="flex justify-between gap-2">
                  <dt>Comissão bruta</dt>
                  <dd className="tabular">{formatCurrency(row?.total_gross_commission ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Repasses</dt>
                  <dd className="tabular">{formatCurrency(row?.total_broker_payout ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Entradas</dt>
                  <dd className="tabular">{formatInteger(row?.entries_count ?? 0)}</dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
    </>
  );
}
