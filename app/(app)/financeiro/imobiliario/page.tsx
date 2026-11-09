import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { PeriodFilter } from "@/components/finance/period-filter";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { FIN_OPERATION_KIND_LABELS } from "@/lib/formatting/labels";
import {
  getFinLookups,
  getFinPropertyResults,
  getFinSummary,
  listCommissionsNotInCash,
  listFinOperations,
} from "@/server/queries/finance";
import { financeYears, resolveFinanceFilters, type FinanceSearchParams } from "@/features/finance/filters";
import { NoAccountsNotice, PendingCommissions, RentalCollectionButton } from "@/features/finance/real-estate-panel";

export const metadata: Metadata = { title: "Inteligência imobiliária" };

export default async function RealEstatePage({ searchParams }: { searchParams: Promise<FinanceSearchParams> }) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const { filters, period } = resolveFinanceFilters(await searchParams);

  const [lookups, summary, commissions, operations, properties] = await Promise.all([
    getFinLookups(),
    getFinSummary({ ...filters, accountId: null, categoryId: null, nature: null }),
    listCommissionsNotInCash(),
    listFinOperations(30),
    getFinPropertyResults(period.from, period.to),
  ]);

  const activeProperties = properties.filter(
    (row) => row.rent_collected || row.own_revenue || row.owner_pending || row.owner_transferred || row.direct_expenses,
  );

  return (
    <>
      <PageHeader
        title="Inteligência imobiliária"
        description="Aluguéis, taxas de administração, comissões e repasses — separando o que é da imobiliária do que pertence a proprietários e corretores."
        actions={canWrite ? <RentalCollectionButton lookups={lookups} /> : null}
      />

      {canWrite && lookups.accounts.length === 0 ? <NoAccountsNotice /> : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Obrigações com terceiros"
          value={formatCurrency(summary.third_party_obligations)}
          hint="Total a repassar a proprietários e corretores"
          formula="Dinheiro recebido em nome de terceiros que ainda não foi repassado. Não é receita."
        />
        <MetricCard
          label="Repasses de comissão pendentes"
          value={formatCurrency(summary.broker_payouts_pending)}
          hint="Parcela dos corretores ainda não paga"
        />
        <MetricCard
          label="Comissões fora do caixa"
          value={formatCurrency(commissions.reduce((sum, row) => sum + row.gross_commission, 0))}
          hint={`${commissions.length} comissão(ões) registradas sem entrada nas contas`}
        />
        <MetricCard
          label="Cauções de terceiros"
          value={formatCurrency(summary.deposits_held)}
          hint="Depósitos reembolsáveis em poder da imobiliária"
        />
      </div>

      <div className="mb-5">
        <PendingCommissions rows={commissions} lookups={lookups} canWrite={canWrite} />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Resultado por imóvel</CardTitle>
            <CardDescription>{period.label} · aluguel recebido, receita da imobiliária e repasses ao proprietário</CardDescription>
          </div>
          <PeriodFilter years={financeYears()} />
        </CardHeader>
        <CardContent className="p-0">
          {activeProperties.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Nenhuma movimentação de imóveis no período."
              description="Cadastre os imóveis administrados em Cadastros e registre os aluguéis recebidos para ver o resultado da administração por imóvel."
            />
          ) : (
            <TableWrapper>
              <Table>
                <caption className="sr-only">Resultado por imóvel</caption>
                <THead>
                  <TR>
                    <TH>Imóvel</TH>
                    <TH numeric>Aluguel recebido</TH>
                    <TH numeric>Receita da imobiliária</TH>
                    <TH numeric>Repassado</TH>
                    <TH numeric>A repassar</TH>
                    <TH numeric>Despesas do imóvel</TH>
                    <TH numeric>Resultado</TH>
                  </TR>
                </THead>
                <TBody>
                  {activeProperties.map((row) => (
                    <TR key={row.property_id}>
                      <TD className="font-medium">{row.label}</TD>
                      <TD numeric>{formatCurrency(row.rent_collected)}</TD>
                      <TD numeric>{formatCurrency(row.own_revenue)}</TD>
                      <TD numeric>{formatCurrency(row.owner_transferred)}</TD>
                      <TD numeric className={row.owner_pending > 0 ? "font-medium text-warning" : undefined}>
                        {formatCurrency(row.owner_pending)}
                      </TD>
                      <TD numeric>{formatCurrency(row.direct_expenses)}</TD>
                      <TD numeric className={row.result < 0 ? "font-semibold text-danger" : "font-semibold"}>
                        {formatCurrency(row.result)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
                <TFoot>
                  <TR className="hover:bg-transparent">
                    <TD>Total</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.rent_collected, 0))}</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.own_revenue, 0))}</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.owner_transferred, 0))}</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.owner_pending, 0))}</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.direct_expenses, 0))}</TD>
                    <TD numeric>{formatCurrency(activeProperties.reduce((s, r) => s + r.result, 0))}</TD>
                  </TR>
                </TFoot>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Operações recentes</CardTitle>
            <CardDescription>Cada operação agrupa a entrada no caixa, a receita da imobiliária e os repasses gerados.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {operations.length === 0 ? (
            <EmptyState icon="inbox" title="Nenhuma operação registrada ainda." />
          ) : (
            <ul className="divide-y divide-border">
              {operations.map((operation) => (
                <li key={operation.id}>
                  <Link
                    href={`/financeiro/lancamentos?operacao=${operation.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{operation.description}</p>
                      <p className="text-[11.5px] text-subtle">
                        {FIN_OPERATION_KIND_LABELS[operation.kind]} · {formatDate(operation.reference_date)}
                        {operation.counterparty_name ? ` · ${operation.counterparty_name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-[12.5px]">
                      {operation.cancelled_at ? <Badge tone="neutral">Cancelada</Badge> : null}
                      <span className="tabular text-muted">
                        Entrou <strong className="text-foreground">{formatCurrency(operation.gross_amount)}</strong>
                      </span>
                      <span className="tabular text-muted">
                        Imobiliária <strong className="text-foreground">{formatCurrency(operation.own_amount)}</strong>
                      </span>
                      <span className="tabular text-muted">
                        Terceiros <strong className="text-foreground">{formatCurrency(operation.third_party_amount)}</strong>
                      </span>
                      <ArrowRight className="size-3.5 text-subtle" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
