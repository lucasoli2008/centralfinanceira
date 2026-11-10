import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info, Landmark, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { InfoTooltip } from "@/components/ui/tooltip";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { trailingTwelveMonths } from "@/lib/period";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";
import { FIN_ACCOUNT_KIND_LABELS, FIN_REGIME_LABELS } from "@/lib/formatting/labels";
import { cn } from "@/lib/utils";
import {
  getFinAccountBalances,
  getFinByCategory,
  getFinMonthly,
  getFinSummary,
  listFinAccounts,
  listFinCategories,
} from "@/server/queries/finance";
import { FinanceFilters } from "@/features/finance/finance-filters";
import { InsightList } from "@/features/finance/insight-list";
import { getFinInsights } from "@/server/queries/finance-reports";
import { financeYears, resolveFinanceFilters, type FinanceSearchParams } from "@/features/finance/filters";
import {
  CashBalanceChart,
  CashInOutChart,
  CategoryBreakdown,
  MarginTrendChart,
  PlannedVsActualChart,
  ResultEvolutionChart,
  RevenueCompositionChart,
} from "@/features/finance/finance-charts";

export const metadata: Metadata = { title: "Painel analítico" };

function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<FinanceSearchParams>;
}) {
  const context = await requireFinance("view");
  const params = await searchParams;
  const { filters, period } = resolveFinanceFilters(params);
  const twelve = trailingTwelveMonths(period.to);
  const canWrite = financeCan(context.financeRole, "write");

  const [accounts, categories, summary, previous, monthly, expensesByCategory, revenueByCategory, balances, insights] =
    await Promise.all([
      listFinAccounts(),
      listFinCategories(),
      getFinSummary(filters),
      period.previous
        ? getFinSummary({ ...filters, from: period.previous.from, to: period.previous.to })
        : Promise.resolve(null),
      getFinMonthly({ ...filters, from: twelve.from, to: twelve.to }),
      getFinByCategory(filters, "expense"),
      getFinByCategory(filters, "income"),
      getFinAccountBalances(),
      getFinInsights(),
    ]);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader
          title="Controle Financeiro"
          description="Toda a movimentação da imobiliária em um só lugar: o que entrou, o que saiu, o que é de terceiros e o que ainda falta pagar ou receber."
        />
        <div className="surface-card">
          <EmptyState
            title="Comece cadastrando suas contas financeiras"
            description="Cadastre a conta corrente, a poupança e o caixa da imobiliária com o saldo de hoje. A partir daí, cada lançamento atualiza os saldos e este painel automaticamente."
            actionLabel={canWrite ? "Cadastrar primeira conta" : undefined}
            actionHref={canWrite ? "/financeiro/cadastros?aba=contas&novo=1" : undefined}
            icon="inbox"
          />
        </div>
      </>
    );
  }

  const expenseTotal =
    summary.deductions + summary.direct_costs + summary.operating_expenses + summary.other_expenses;
  const revenueTotal = summary.own_revenue + summary.other_revenue;
  const regimeLabel = FIN_REGIME_LABELS[filters.regime];
  const comparison = period.previous ? `vs. ${period.previous.label}` : undefined;
  const pendingCount = summary.commissions_not_in_cash_count;

  return (
    <>
      <PageHeader
        title="Painel analítico"
        description={`${period.label} · resultado pelo regime de ${regimeLabel.toLowerCase()}. Valores de terceiros (aluguéis a repassar, parcelas de corretores, cauções) nunca contam como receita.`}
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/financeiro/lancamentos?novo=1">
                <Plus />
                Novo lançamento
              </Link>
            </Button>
          ) : null
        }
      />

      <FinanceFilters years={financeYears()} accounts={accounts} categories={categories} />

      {/* Saúde financeira em uma linha ------------------------------------ */}
      <section aria-label="Posição de caixa" className="mb-5 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="surface-card relative overflow-hidden p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="label-caption flex items-center gap-1.5">
                <Landmark className="size-3.5" />
                Saldo em contas
                <InfoTooltip
                  label="Saldo em contas"
                  content="Soma do saldo de todas as contas no livro-razão até o fim do período. Inclui dinheiro que pertence a terceiros (aluguéis a repassar, parcelas de corretores, cauções)."
                />
              </p>
              <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] tabular">
                {formatCurrency(summary.cash_balance)}
              </p>
            </div>
            <div className="text-right">
              <p className="label-caption">Disponível da imobiliária</p>
              <p
                className={cn(
                  "mt-2 text-[22px] font-semibold leading-none tabular",
                  summary.own_available < 0 && "text-danger",
                )}
              >
                {formatCurrency(summary.own_available)}
              </p>
            </div>
          </div>

          {/* Barra de composição do saldo: próprio x terceiros x cauções */}
          {summary.cash_balance > 0 ? (
            <div className="mt-5">
              <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="h-full bg-foreground/80"
                  style={{ width: `${Math.max(0, Math.min(100, (summary.own_available / summary.cash_balance) * 100))}%` }}
                />
                <span
                  className="h-full bg-warning/70"
                  style={{ width: `${Math.max(0, Math.min(100, (summary.third_party_obligations / summary.cash_balance) * 100))}%` }}
                />
                <span
                  className="h-full bg-info/60"
                  style={{ width: `${Math.max(0, Math.min(100, (summary.deposits_held / summary.cash_balance) * 100))}%` }}
                />
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
                <li className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-foreground/80" /> Próprio {formatCurrency(summary.own_available)}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning/70" /> A repassar {formatCurrency(summary.third_party_obligations)}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-info/60" /> Cauções {formatCurrency(summary.deposits_held)}
                </li>
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            label="Resultado do período"
            value={formatCurrency(summary.net_result)}
            variation={previous ? variation(summary.net_result, previous.net_result) : undefined}
            comparisonLabel={comparison}
            formula="Receita própria + outras receitas − deduções − custos diretos − despesas operacionais − outras despesas. Não inclui valores de terceiros, cauções nem movimentos de sócios."
            className={summary.net_result < 0 ? "border-danger/30" : undefined}
          />
          <MetricCard
            label="Previsão de caixa (30 dias)"
            value={formatCurrency(summary.forecast_30_balance)}
            hint="Saldo de hoje + a receber − a pagar com vencimento em até 30 dias"
            formula="Considera apenas títulos cadastrados (inclusive previsões). Nenhuma receita é inventada."
            className={summary.forecast_30_balance < 0 ? "border-danger/30" : undefined}
          />
        </div>
      </section>

      {/* Indicadores ------------------------------------------------------ */}
      <section aria-label="Indicadores do período" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Entradas recebidas"
          value={formatCurrency(summary.cash_in)}
          variation={previous ? variation(summary.cash_in, previous.cash_in) : undefined}
          comparisonLabel={comparison}
          formula="Soma das baixas de entradas no período (inclui valores de terceiros que passaram pelo caixa)."
        />
        <MetricCard
          label="Saídas pagas"
          value={formatCurrency(summary.cash_out)}
          variation={previous ? variation(summary.cash_out, previous.cash_out) : undefined}
          comparisonLabel={comparison}
          invertVariationColor
          formula="Soma das baixas de saídas no período (inclui repasses a proprietários e corretores)."
        />
        <MetricCard
          label="Receita própria"
          value={formatCurrency(revenueTotal)}
          variation={previous ? variation(revenueTotal, previous.own_revenue + previous.other_revenue) : undefined}
          comparisonLabel={comparison}
          emphasis
          formula="Somente categorias de receita própria e outras receitas. Taxas de administração e a parte da imobiliária nas comissões entram aqui; aluguel do proprietário e parcela de corretores não."
        />
        <MetricCard
          label="Despesas e custos"
          value={formatCurrency(expenseTotal)}
          variation={previous ? variation(expenseTotal, previous.deductions + previous.direct_costs + previous.operating_expenses + previous.other_expenses) : undefined}
          comparisonLabel={comparison}
          invertVariationColor
          formula="Deduções + custos diretos + despesas operacionais + outras despesas. Retiradas de sócios ficam de fora."
        />
        <MetricCard
          label="Contas a receber"
          value={formatCurrency(summary.receivables_open)}
          hint={
            summary.receivables_overdue > 0
              ? `${formatCurrency(summary.receivables_overdue)} em atraso`
              : "Nenhum recebível em atraso"
          }
          className={summary.receivables_overdue > 0 ? "border-warning/40" : undefined}
        />
        <MetricCard
          label="Contas a pagar"
          value={formatCurrency(summary.payables_open)}
          hint={summary.payables_overdue > 0 ? `${formatCurrency(summary.payables_overdue)} vencidos` : "Nenhuma conta vencida"}
          formula="Obrigações da própria imobiliária ainda não pagas. Repasses a terceiros aparecem no indicador ao lado."
          className={summary.payables_overdue > 0 ? "border-danger/30" : undefined}
        />
        <MetricCard
          label="Obrigações com terceiros"
          value={formatCurrency(summary.third_party_obligations)}
          hint="Repasses a proprietários e corretores"
          formula="Dinheiro recebido que pertence a terceiros e ainda não foi repassado."
        />
        <MetricCard
          label="Comissões pendentes"
          value={formatCurrency(summary.broker_payouts_pending)}
          hint={
            pendingCount > 0
              ? `${formatInteger(pendingCount)} comissões do período ainda fora do caixa`
              : "Repasses a corretores em aberto"
          }
          formula="Repasses de comissão a corretores ainda não pagos. O texto abaixo indica comissões registradas que ainda não foram lançadas no caixa."
        />
      </section>

      {/* Alertas (central de inteligência) ------------------------------ */}
      {insights.length ? (
        <section aria-label="Alertas" className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="label-caption">Alertas</p>
            <Link href="/financeiro/inteligencia" className="text-[12.5px] font-medium text-accent hover:underline">
              Ver todos ({insights.length}) →
            </Link>
          </div>
          <InsightList insights={insights.slice(0, 3)} explain={false} />
        </section>
      ) : null}

      {/* Gráficos --------------------------------------------------------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Receitas, despesas e resultado</CardTitle>
              <CardDescription>Últimos 12 meses · regime de {regimeLabel.toLowerCase()}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ResultEvolutionChart series={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Composição da receita própria</CardTitle>
              <CardDescription>{period.label}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueCompositionChart rows={revenueByCategory} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Entradas x saídas</CardTitle>
              <CardDescription>Dinheiro que efetivamente passou pelas contas</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CashInOutChart series={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fluxo de caixa acumulado</CardTitle>
              <CardDescription>Saldo consolidado no fim de cada mês</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CashBalanceChart series={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Despesas por categoria</CardTitle>
              <CardDescription>{period.label}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown
              rows={expensesByCategory.filter((row) => row.nature !== "third_party" && row.nature !== "deposit" && row.nature !== "equity")}
              emptyMessage="Nenhuma despesa no período."
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Realizado x previsto</CardTitle>
              <CardDescription>Títulos com vencimento no mês comparados às baixas efetivas</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <PlannedVsActualChart series={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Tendência de rentabilidade</CardTitle>
              <CardDescription>Resultado ÷ receitas, mês a mês</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <MarginTrendChart series={monthly} />
          </CardContent>
        </Card>
      </div>

      {/* Saldos por conta ------------------------------------------------- */}
      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Saldos por conta</CardTitle>
            <CardDescription>Posição de hoje no livro-razão</CardDescription>
          </div>
          <Link
            href="/financeiro/cadastros?aba=contas"
            className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
          >
            Gerenciar contas
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {balances.map((account) => (
              <li key={account.account_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link
                  href={`/financeiro/lancamentos?conta=${account.account_id}`}
                  className="min-w-0 hover:text-accent"
                >
                  <p className="truncate text-[13px] font-medium">
                    {account.name}
                    {account.is_active ? null : <span className="ml-2 text-xs text-subtle">(inativa)</span>}
                  </p>
                  <p className="text-[11.5px] text-subtle">{FIN_ACCOUNT_KIND_LABELS[account.kind]}</p>
                </Link>
                <span className={cn("text-[14px] font-semibold tabular", account.balance < 0 && "text-danger")}>
                  {formatCurrency(account.balance)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="mt-4 flex items-start gap-1.5 text-[11.5px] text-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Todos os números desta tela vêm das mesmas funções de relatório do banco; exportações e relatórios usam exatamente a
        mesma fonte.
      </p>
    </>
  );
}

