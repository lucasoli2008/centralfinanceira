import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/finance/period-filter";
import { StatGroup, type StatItem } from "@/components/finance/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CompositionChart,
  MonthlyEvolutionChart,
  NetRevenueChart,
  SalesVsRentalsChart,
} from "@/components/dashboard/charts";
import { HeroPanel } from "@/components/dashboard/hero-panel";
import { MonthStrip } from "@/components/dashboard/month-strip";
import { BrokerRanking } from "@/components/dashboard/broker-ranking";
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
    { label: "Corretores no período", value: formatInteger(ranking.length) },
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

      {/* Resultado do período ---------------------------------------------- */}
      <div className="stagger grid gap-3 xl:grid-cols-3">
        <HeroPanel
          className="xl:col-span-2"
          periodLabel={period.label}
          netRevenue={Number(summary.total_net_revenue)}
          grossCommission={Number(summary.total_gross_commission)}
          brokerPayout={Number(summary.total_broker_payout)}
          entriesCount={summary.entries_count}
          netMargin={summary.net_margin === null ? null : Number(summary.net_margin)}
          variation={variation(summary.total_net_revenue, previousSummary?.total_net_revenue)}
          comparisonLabel={period.previous?.label}
          trend={series.map((row) => Number(row.total_net_revenue))}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Composição financeira</CardTitle>
              <CardDescription>Quanto ficou e quanto foi repassado.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CompositionChart
              netRevenue={Number(summary.total_net_revenue)}
              brokerPayout={Number(summary.total_broker_payout)}
            />
          </CardContent>
        </Card>
      </div>

      {/* Evolução ----------------------------------------------------------- */}
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
              <CardTitle>Receita líquida por mês</CardTitle>
              <CardDescription>O que ficou para a imobiliária.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <NetRevenueChart series={series} />
          </CardContent>
        </Card>
      </div>

      {/* Indicadores por origem --------------------------------------------- */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <StatGroup title="Vendas" items={salesStats} />
        <StatGroup title="Locações" items={rentalStats} />
        <StatGroup title="Indicadores do período" items={indicatorStats} />
      </div>

      <Card className="mt-3">
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

      {/* Ano ---------------------------------------------------------------- */}
      <Card className="mt-3">
        <CardHeader>
          <div>
            <CardTitle>Os 12 meses de {currentYear}</CardTitle>
            <CardDescription>
              A altura da barra compara a receita líquida com o melhor mês do ano.
            </CardDescription>
          </div>
          <Link
            href="/meses"
            className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            Ver detalhe de cada mês
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          <MonthStrip year={currentYear} series={yearSeries} closedMonths={closedMonths} />
        </CardContent>
      </Card>

      {/* Corretores --------------------------------------------------------- */}
      <Card className="mt-3 overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Ranking de corretores</CardTitle>
            <CardDescription>
              {period.label}. Volume e comissão referem-se às operações em que o corretor
              participou — não são receita individual dele.
            </CardDescription>
          </div>
        </CardHeader>
        <BrokerRanking ranking={ranking} totalPayout={Number(summary.total_broker_payout)} />
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
