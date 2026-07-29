import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, FileDown, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, VariationBadge } from "@/components/finance/metric-card";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { ClosingActions } from "@/features/months/closing-actions";
import { requireAppContext } from "@/lib/auth/session";
import {
  getBrokerRanking,
  getMonthClosing,
  getSummary,
  listAllEntries,
} from "@/server/queries/entries";
import { calculateVariation } from "@/lib/finance/engine";
import { formatCurrency, formatInteger, formatPercent } from "@/lib/formatting/number";
import {
  addMonths,
  firstDayOfMonth,
  formatDate,
  formatMonthYear,
  lastDayOfMonth,
} from "@/lib/formatting/date";
import { ENTRY_TYPE_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/formatting/labels";

export const metadata: Metadata = { title: "Visão mensal" };

export default async function MesPage({
  params,
}: {
  params: Promise<{ ano: string; mes: string }>;
}) {
  const { ano, mes } = await params;
  const year = Number(ano);
  const month = Number(mes);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    notFound();
  }

  const context = await requireAppContext();

  const from = firstDayOfMonth(year, month);
  const to = lastDayOfMonth(year, month);
  const previous = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);

  const [summary, previousSummary, lastYearSummary, entries, ranking, closing] = await Promise.all([
    getSummary({ from, to }),
    getSummary({
      from: firstDayOfMonth(previous.year, previous.month),
      to: lastDayOfMonth(previous.year, previous.month),
    }),
    getSummary({
      from: firstDayOfMonth(year - 1, month),
      to: lastDayOfMonth(year - 1, month),
    }),
    listAllEntries({ from, to }),
    getBrokerRanking({ from, to }),
    getMonthClosing(year, month),
  ]);

  const isClosed = closing?.status === "closed";
  const closingEnabled = context.settings.monthly_closing_enabled;

  return (
    <>
      <PageHeader
        title={formatMonthYear(year, month)}
        description="Todos os números vêm da base única de lançamentos, filtrados pela data da entrada."
        backHref="/meses"
        backLabel="Visão anual"
        actions={
          <>
            <Button asChild variant="secondary">
              <a
                href={`/api/relatorios/mensal?ano=${year}&mes=${month}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileDown />
                PDF do mês
              </a>
            </Button>
            <ClosingActions
              year={year}
              month={month}
              isClosed={isClosed}
              enabled={closingEnabled}
            />
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-2 text-[13px]" aria-label="Navegação entre meses">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/meses/${previous.year}/${previous.month}`}>
              <ChevronLeft />
              {formatMonthYear(previous.year, previous.month)}
            </Link>
          </Button>
          <span className="font-medium">{formatMonthYear(year, month)}</span>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/meses/${next.year}/${next.month}`}>
              {formatMonthYear(next.year, next.month)}
              <ChevronRight />
            </Link>
          </Button>
        </nav>

        {isClosed ? (
          <Badge tone="warning">
            <Lock className="size-2.5" />
            Mês fechado
          </Badge>
        ) : closingEnabled ? (
          <Badge tone="neutral">Mês aberto</Badge>
        ) : null}
      </div>

      {isClosed ? (
        <p className="mb-6 rounded-card border border-warning bg-warning-soft px-4 py-3 text-[13px] text-warning">
          Este mês financeiro está fechado. Reabra o mês antes de realizar alterações.
          {closing?.reopen_reason ? ` Última reabertura: ${closing.reopen_reason}.` : ""}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receita líquida"
          value={formatCurrency(summary.total_net_revenue)}
          variation={calculateVariation(
            summary.total_net_revenue,
            previousSummary.total_net_revenue,
          )}
          comparisonLabel={formatMonthYear(previous.year, previous.month)}
          emphasis
        />
        <MetricCard
          label="Comissão bruta"
          value={formatCurrency(summary.total_gross_commission)}
          variation={calculateVariation(
            summary.total_gross_commission,
            previousSummary.total_gross_commission,
          )}
          comparisonLabel={formatMonthYear(previous.year, previous.month)}
        />
        <MetricCard
          label="Total de repasses"
          value={formatCurrency(summary.total_broker_payout)}
          variation={calculateVariation(
            summary.total_broker_payout,
            previousSummary.total_broker_payout,
          )}
          comparisonLabel={formatMonthYear(previous.year, previous.month)}
          invertVariationColor
        />
        <MetricCard
          label="Entradas no mês"
          value={formatInteger(summary.entries_count)}
          hint={`${formatInteger(summary.sales_count)} vendas · ${formatInteger(
            summary.rental_count,
          )} locações`}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Comissão de vendas"
          value={formatCurrency(summary.sales_gross_commission)}
        />
        <MetricCard
          label="Comissão de locações"
          value={formatCurrency(summary.rental_gross_commission)}
        />
        <MetricCard
          label="Ticket médio"
          value={
            summary.average_gross_commission === null
              ? "—"
              : formatCurrency(summary.average_gross_commission)
          }
          formula="Comissão bruta ÷ quantidade de entradas."
        />
        <MetricCard
          label="Margem líquida"
          value={summary.net_margin === null ? "Sem base para cálculo" : formatPercent(summary.net_margin)}
          formula="Receita líquida ÷ comissão bruta × 100."
        />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="section-title">Comparações</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-control border border-border p-4">
            <p className="label-caption">
              Contra {formatMonthYear(previous.year, previous.month)}
            </p>
            <p className="mt-1 text-[13px]">
              Receita líquida: {formatCurrency(previousSummary.total_net_revenue)}
            </p>
            <VariationBadge
              variation={calculateVariation(
                summary.total_net_revenue,
                previousSummary.total_net_revenue,
              )}
              comparisonLabel={formatMonthYear(previous.year, previous.month)}
            />
          </div>

          <div className="rounded-control border border-border p-4">
            <p className="label-caption">Contra {formatMonthYear(year - 1, month)}</p>
            <p className="mt-1 text-[13px]">
              Receita líquida: {formatCurrency(lastYearSummary.total_net_revenue)}
            </p>
            <VariationBadge
              variation={calculateVariation(
                summary.total_net_revenue,
                lastYearSummary.total_net_revenue,
              )}
              comparisonLabel={formatMonthYear(year - 1, month)}
            />
          </div>
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader>
          <CardTitle>Ranking de corretores no mês</CardTitle>
        </CardHeader>

        {ranking.length === 0 ? (
          <EmptyState
            title="Nenhum repasse neste mês."
            description="Os repasses aparecem aqui assim que houver lançamentos com corretores."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Ranking de corretores do mês</caption>
              <THead>
                <TR>
                  <TH>Corretor</TH>
                  <TH numeric>Participações</TH>
                  <TH numeric>Total recebido</TH>
                  <TH numeric>Média por operação</TH>
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
                    </TD>
                    <TD numeric>{formatInteger(row.participations)}</TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(row.total_payout)}
                    </TD>
                    <TD numeric>{formatCurrency(row.average_payout)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader>
          <CardTitle>Lançamentos do mês</CardTitle>
        </CardHeader>

        {entries.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento neste mês."
            description="Registre uma venda ou locação para acompanhar o resultado do mês."
            actionLabel="Registrar venda"
            actionHref="/vendas/nova"
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Lançamentos do mês</caption>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Tipo</TH>
                  <TH>Descrição</TH>
                  <TH>Imóvel</TH>
                  <TH numeric>Valor-base</TH>
                  <TH numeric>Comissão bruta</TH>
                  <TH numeric>Repasses</TH>
                  <TH numeric>Receita líquida</TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.entry_id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(entry.entry_date)}</TD>
                    <TD>{ENTRY_TYPE_LABELS[entry.entry_type]}</TD>
                    <TD>
                      <Link
                        href={`${entry.entry_type === "sale" ? "/vendas" : "/locacoes"}/${entry.entry_id}`}
                        className="hover:text-accent hover:underline"
                      >
                        {entry.description}
                      </Link>
                    </TD>
                    <TD>{PROPERTY_TYPE_LABELS[entry.property_type]}</TD>
                    <TD numeric>{formatCurrency(entry.base_amount)}</TD>
                    <TD numeric>{formatCurrency(entry.gross_commission)}</TD>
                    <TD numeric>{formatCurrency(entry.total_broker_payout)}</TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(entry.net_company_revenue)}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={4}>Total do mês</TD>
                  <TD numeric>
                    {formatCurrency(summary.sales_base_amount + summary.rental_base_amount)}
                  </TD>
                  <TD numeric>{formatCurrency(summary.total_gross_commission)}</TD>
                  <TD numeric>{formatCurrency(summary.total_broker_payout)}</TD>
                  <TD numeric>{formatCurrency(summary.total_net_revenue)}</TD>
                </TR>
              </TFoot>
            </Table>
          </TableWrapper>
        )}
      </Card>
    </>
  );
}
