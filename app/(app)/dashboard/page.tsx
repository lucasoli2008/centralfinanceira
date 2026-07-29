import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/finance/period-filter";
import { MetricCard, StatGroup, type StatItem } from "@/components/finance/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  CompositionChart,
  MonthlyEvolutionChart,
  NetRevenueChart,
  SalesVsRentalsChart,
} from "@/components/dashboard/charts";
import { requireAppContext } from "@/lib/auth/session";
import {
  getBrokerRanking,
  getMonthlySeries,
  getSummary,
  listActiveYears,
  listYearClosings,
} from "@/server/queries/entries";
import { resolvePeriod, trailingTwelveMonths, type PeriodParams } from "@/lib/period";
import { calculateVariation, safeRatio } from "@/lib/finance/engine";
import { formatCurrency, formatInteger, formatPercent } from "@/lib/formatting/number";
import { formatDate, monthName } from "@/lib/formatting/date";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<PeriodParams>;
}) {
  const params = await searchParams;
  await requireAppContext();

  const period = resolvePeriod(params);
  const twelveMonths = trailingTwelveMonths(period.to);
  const currentYear = Number(period.to.slice(0, 4));

  const [summary, previousSummary, series, ranking, years, closings] = await Promise.all([
    getSummary({ from: period.from, to: period.to }),
    period.previous
      ? getSummary({ from: period.previous.from, to: period.previous.to })
      : Promise.resolve(null),
    getMonthlySeries(twelveMonths.from, twelveMonths.to),
    getBrokerRanking({ from: period.from, to: period.to }),
    listActiveYears(),
    listYearClosings(currentYear),
  ]);

  const variation = (current: number, previous: number | undefined | null) =>
    previous === undefined || previous === null ? null : calculateVariation(current, previous);

  const yearSeries = series.filter((row) => row.year === currentYear);
  const closedMonths = new Set(
    closings.filter((closing) => closing.status === "closed").map((closing) => closing.month),
  );

  const salesStats: StatItem[] = [
    { label: "Comissão bruta", value: formatCurrency(summary.sales_gross_commission) },
    { label: "Receita líquida", value: formatCurrency(summary.sales_net_revenue), tone: "positive" },
    { label: "Volume vendido", value: formatCurrency(summary.sales_base_amount) },
    { label: "Nº de vendas", value: formatInteger(summary.sales_count) },
    {
      label: "Comissão média",
      value:
        summary.sales_count === 0
          ? "—"
          : formatCurrency(safeRatio(summary.sales_gross_commission, summary.sales_count) ?? 0),
      formula: "Comissão bruta de vendas ÷ número de vendas.",
    },
    {
      label: "% médio ponderado",
      value:
        summary.weighted_sale_commission_rate === null
          ? "—"
          : formatPercent(summary.weighted_sale_commission_rate),
      formula: "Comissão bruta de vendas ÷ volume vendido × 100.",
    },
  ];

  const rentalStats: StatItem[] = [
    { label: "Comissão bruta", value: formatCurrency(summary.rental_gross_commission) },
    { label: "Receita líquida", value: formatCurrency(summary.rental_net_revenue), tone: "positive" },
    {
      label: "Soma dos 1ºs aluguéis",
      value: formatCurrency(summary.rental_base_amount),
      formula: "Base de cálculo das comissões de locação.",
    },
    { label: "Nº de locações", value: formatInteger(summary.rental_count) },
    {
      label: "Comissão média",
      value:
        summary.rental_count === 0
          ? "—"
          : formatCurrency(safeRatio(summary.rental_gross_commission, summary.rental_count) ?? 0),
      formula: "Comissão bruta de locações ÷ número de locações.",
    },
  ];

  const indicatorStats: StatItem[] = [
    {
      label: "Ticket médio da comissão",
      value:
        summary.average_gross_commission === null
          ? "—"
          : formatCurrency(summary.average_gross_commission),
      formula: "Comissão bruta total ÷ quantidade de entradas.",
    },
    {
      label: "Margem líquida média",
      value: summary.net_margin === null ? "Sem base" : formatPercent(summary.net_margin),
      formula: "Receita líquida ÷ comissão bruta × 100.",
      tone: summary.net_margin !== null && summary.net_margin < 0 ? "danger" : "default",
    },
    {
      label: "% médio de repasses",
      value:
        summary.average_broker_payout_rate === null
          ? "—"
          : formatPercent(summary.average_broker_payout_rate),
      formula: "Total repassado ÷ comissão bruta × 100.",
    },
    {
      label: "Corretores no período",
      value: formatInteger(ranking.length),
    },
    {
      label: "Repasse médio por corretor",
      value: formatCurrency(
        safeRatio(
          ranking.reduce((total, row) => total + Number(row.total_payout), 0),
          ranking.length,
        ) ?? 0,
      ),
      formula: "Total repassado ÷ número de corretores com participação no período.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Comissões efetivamente recebidas em ${period.label.toLowerCase()}, no regime de caixa.`}
        actions={<PeriodFilter years={years} />}
      />

      {/* KPIs principais --------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receita líquida da imobiliária"
          value={formatCurrency(summary.total_net_revenue)}
          variation={variation(summary.total_net_revenue, previousSummary?.total_net_revenue)}
          comparisonLabel={period.previous?.label}
          formula="Comissão bruta − soma dos repasses aos corretores."
          emphasis
        />
        <MetricCard
          label="Comissão bruta total"
          value={formatCurrency(summary.total_gross_commission)}
          variation={variation(summary.total_gross_commission, previousSummary?.total_gross_commission)}
          comparisonLabel={period.previous?.label}
          formula="Soma das comissões de vendas e locações, cada uma arredondada para duas casas."
        />
        <MetricCard
          label="Repassado aos corretores"
          value={formatCurrency(summary.total_broker_payout)}
          variation={variation(summary.total_broker_payout, previousSummary?.total_broker_payout)}
          comparisonLabel={period.previous?.label}
          formula="Soma dos repasses, cada um arredondado individualmente antes da soma."
          invertVariationColor
        />
        <MetricCard
          label="Entradas registradas"
          value={formatInteger(summary.entries_count)}
          variation={variation(summary.entries_count, previousSummary?.entries_count)}
          comparisonLabel={period.previous?.label}
          formula="Número de lançamentos de comissão no período (vendas + locações)."
        />
      </div>

      {/* Indicadores agrupados -------------------------------------------- */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <StatGroup title="Vendas" items={salesStats} />
        <StatGroup title="Locações" items={rentalStats} />
        <StatGroup title="Indicadores do período" items={indicatorStats} />
      </div>

      {/* Gráficos ---------------------------------------------------------- */}
      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Evolução financeira mensal</CardTitle>
              <CardDescription>
                Últimos 12 meses. Meses sem movimento aparecem zerados.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <MonthlyEvolutionChart series={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Composição financeira</CardTitle>
              <CardDescription>{period.label}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CompositionChart
              netRevenue={Number(summary.total_net_revenue)}
              brokerPayout={Number(summary.total_broker_payout)}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Vendas versus locações</CardTitle>
              <CardDescription>Comissão bruta por origem, mês a mês.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <SalesVsRentalsChart series={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Receita líquida por mês</CardTitle>
              <CardDescription>O que ficou para a imobiliária.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <NetRevenueChart series={series} />
          </CardContent>
        </Card>
      </div>

      {/* Ranking ----------------------------------------------------------- */}
      <Card className="mt-3 overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Ranking de corretores</CardTitle>
            <CardDescription>
              {period.label}. Volume e comissão bruta referem-se às operações em que o corretor
              participou — não são receita individual dele.
            </CardDescription>
          </div>
        </CardHeader>

        {ranking.length === 0 ? (
          <EmptyState
            title="Nenhum repasse registrado neste período."
            description="Assim que houver lançamentos com corretores, o ranking aparece aqui."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Ranking de corretores do período</caption>
              <THead>
                <TR>
                  <TH>Corretor</TH>
                  <TH numeric>Particip.</TH>
                  <TH numeric>Total de repasses</TH>
                  <TH numeric>Média por operação</TH>
                  <TH numeric>Volume das operações</TH>
                  <TH>Última participação</TH>
                </TR>
              </THead>
              <TBody>
                {ranking.map((row) => (
                  <TR key={row.broker_id}>
                    <TD>
                      <Link
                        href={`/corretores/${row.broker_id}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {row.broker_name}
                      </Link>
                      {row.broker_is_active ? null : (
                        <Badge tone="neutral" className="ml-1.5">
                          Inativo
                        </Badge>
                      )}
                    </TD>
                    <TD numeric>{formatInteger(row.participations)}</TD>
                    <TD numeric className="font-semibold">
                      {formatCurrency(row.total_payout)}
                    </TD>
                    <TD numeric className="text-muted">
                      {formatCurrency(row.average_payout)}
                    </TD>
                    <TD numeric className="text-muted">
                      {formatCurrency(row.participated_base_amount)}
                    </TD>
                    <TD className="text-muted">
                      {row.last_participation ? formatDate(row.last_participation) : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {/* Visão anual ------------------------------------------------------- */}
      <Card className="mt-3">
        <CardHeader>
          <div>
            <CardTitle>Os 12 meses de {currentYear}</CardTitle>
            <CardDescription>Clique em um mês para abrir a visão detalhada.</CardDescription>
          </div>
          <Link
            href="/meses"
            className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            Ver todos os meses
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
              const row = yearSeries.find((item) => item.month === month);
              const hasMovement = (row?.entries_count ?? 0) > 0;

              return (
                <li key={month}>
                  <Link
                    href={`/meses/${currentYear}/${month}`}
                    className="block rounded-control border border-border px-3 py-2.5 transition-colors hover:border-accent-border hover:bg-accent-soft"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-medium">{monthName(month)}</p>
                      {closedMonths.has(month) ? (
                        <Badge tone="warning">
                          <Lock />
                          Fechado
                        </Badge>
                      ) : null}
                    </div>

                    <p
                      className={
                        hasMovement
                          ? "metric-value-sm mt-1.5"
                          : "metric-value-sm mt-1.5 text-subtle"
                      }
                    >
                      {formatCurrency(row?.total_net_revenue ?? 0)}
                    </p>

                    <dl className="mt-1.5 space-y-0.5 text-[11.5px] text-muted">
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
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {summary.entries_count === 0 ? (
        <p className="mt-5 text-center text-[12.5px] text-muted">
          Nenhum lançamento em {period.label.toLowerCase()}. Ajuste o filtro de período ou registre
          uma entrada em{" "}
          <Link href="/vendas/nova" className="font-medium text-accent hover:underline">
            vendas
          </Link>{" "}
          ou{" "}
          <Link href="/locacoes/nova" className="font-medium text-accent hover:underline">
            locações
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
