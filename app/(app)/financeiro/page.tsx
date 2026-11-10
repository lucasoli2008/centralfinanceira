import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, FileText, LineChart } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { getFinLookups, getFinSummary } from "@/server/queries/finance";
import { getFinInsights } from "@/server/queries/finance-reports";
import { getYearCards } from "@/server/queries/finance-month";
import { InsightList } from "@/features/finance/insight-list";
import { MonthCard, type MonthState } from "@/features/finance/month-card";
import { QuickEntryButton } from "@/features/finance/quick-entry-sheet";

export const metadata: Metadata = { title: "Controle Financeiro" };

export default async function FinanceYearPage({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const params = await searchParams;
  const today = todayInTimezone();
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const year = Number(params.ano) >= 2000 && Number(params.ano) <= 2100 ? Number(params.ano) : currentYear;

  const [lookups, cards, summary, insights] = await Promise.all([
    getFinLookups(),
    getYearCards(year),
    getFinSummary({ from: `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`, to: today, regime: "caixa" }),
    getFinInsights(),
  ]);

  if (lookups.accounts.length === 0) {
    return (
      <>
        <PageHeader title="Controle Financeiro" description="Entradas, saídas e resultado da imobiliária, mês a mês." />
        <div className="surface-card">
          <EmptyState
            title="Comece cadastrando a conta da imobiliária"
            description="Informe o banco e o saldo de hoje. A partir daí, cada mês do ano ganha seu cartão com entradas, saídas e resultado."
            actionLabel={canWrite ? "Cadastrar conta" : undefined}
            actionHref={canWrite ? "/financeiro/cadastros?aba=contas&novo=1" : undefined}
          />
        </div>
      </>
    );
  }

  const scale = Math.max(...cards.map((card) => Math.max(card.cash_in, card.cash_out)), 0);
  const stateOf = (month: number): MonthState =>
    year < currentYear || (year === currentYear && month < currentMonth)
      ? "past"
      : year === currentYear && month === currentMonth
        ? "current"
        : "future";
  const yearResult = cards.reduce((sum, card) => sum + card.result, 0);
  const yearIn = cards.reduce((sum, card) => sum + card.cash_in, 0);
  const yearOut = cards.reduce((sum, card) => sum + card.cash_out, 0);

  return (
    <>
      <PageHeader
        title="Controle Financeiro"
        description="Clique em um mês para ver entradas, saídas, extrato e resultado daquele mês."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? <QuickEntryButton lookups={lookups} /> : null}
            <Button asChild variant="secondary">
              <a href={`/api/financeiro/relatorios?tipo=ano&ano=${year}`} target="_blank" rel="noopener">
                <FileText />
                Relatório do ano
              </a>
            </Button>
          </div>
        }
      />

      {/* Situação de hoje */}
      <section aria-label="Situação de hoje" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Saldo nas contas hoje", value: summary.cash_balance, hint: "Tudo que está no banco e no caixa" },
          {
            label: "Dinheiro da imobiliária",
            value: summary.own_available,
            hint: "Saldo menos o que é de proprietários e corretores",
            strong: true,
          },
          { label: "A pagar", value: summary.payables_open + summary.third_party_obligations, hint: "Contas e repasses em aberto" },
          { label: "A receber", value: summary.receivables_open, hint: "Comissões e taxas em aberto" },
        ].map((item) => (
          <div
            key={item.label}
            className={cn(
              "rounded-2xl border px-4 py-3",
              item.strong ? "border-accent-border bg-accent-soft" : "border-border bg-surface",
            )}
          >
            <p className={cn("text-[11.5px] font-medium", item.strong ? "text-accent" : "text-subtle")}>{item.label}</p>
            <p className={cn("text-[20px] font-semibold tabular", item.value < 0 && "text-danger", item.strong && item.value >= 0 && "text-accent")}>
              {formatCurrency(item.value)}
            </p>
            <p className="text-[11.5px] text-subtle">{item.hint}</p>
          </div>
        ))}
      </section>

      {/* Ano */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold">{year}</h2>
          <p className="text-[12.5px] text-muted">
            Resultado do ano <strong className={cn("tabular", yearResult < 0 ? "text-danger" : "text-positive")}>{formatCurrency(yearResult)}</strong>
            {" · "}entrou {formatCurrency(yearIn)} · saiu {formatCurrency(yearOut)}
          </p>
        </div>
        <nav aria-label="Ano" className="flex gap-1">
          {[currentYear - 1, currentYear, currentYear + 1].map((option) => (
            <Link
              key={option}
              href={option === currentYear ? "/financeiro" : `/financeiro?ano=${option}`}
              aria-current={option === year ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
                option === year ? "bg-foreground text-surface" : "text-muted hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {option}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <MonthCard key={card.month} year={year} card={card} state={stateOf(card.month)} scale={scale} />
        ))}
      </div>

      {insights.length ? (
        <section aria-label="Alertas" className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Pontos de atenção</h2>
            <Link href="/financeiro/inteligencia" className="text-[12.5px] font-medium text-accent hover:underline">
              Ver todos ({insights.length}) →
            </Link>
          </div>
          <InsightList insights={insights.slice(0, 3)} explain={false} />
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 text-[12.5px]">
        <Link href="/financeiro/fluxo" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted hover:text-foreground">
          <LineChart className="size-3.5" /> Fluxo de caixa dos próximos meses
        </Link>
        <Link href="/financeiro/painel" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-muted hover:text-foreground">
          <BarChart3 className="size-3.5" /> Painel analítico com gráficos
        </Link>
      </div>
    </>
  );
}
