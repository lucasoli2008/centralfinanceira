import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { getFinLookups } from "@/server/queries/finance";
import { getYearCards } from "@/server/queries/finance-month";
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

  const [lookups, cards] = await Promise.all([getFinLookups(), getYearCards(year)]);

  const stateOf = (month: number): MonthState =>
    year < currentYear || (year === currentYear && month < currentMonth)
      ? "past"
      : year === currentYear && month === currentMonth
        ? "current"
        : "future";
  const yearIn = cards.reduce((sum, card) => sum + card.revenue, 0);
  const yearOut = cards.reduce((sum, card) => sum + card.expenses, 0);
  const yearLeft = yearIn - yearOut;

  return (
    <>
      <PageHeader
        title="Controle Financeiro"
        description="Cada mês é uma caixa. Clique no mês para ver e cadastrar as saídas; as entradas chegam sozinhas das comissões recebidas."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? <QuickEntryButton lookups={lookups} label="Nova saída" /> : null}
            <Button asChild variant="secondary">
              <a href={`/api/financeiro/relatorios?tipo=ano&ano=${year}`} target="_blank" rel="noopener">
                <FileText />
                Relatório do ano
              </a>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h2 className="text-[22px] font-semibold">{year}</h2>
          <p className="text-[13px] text-muted">
            Entradas <strong className="tabular text-info">{formatCurrency(yearIn)}</strong> · Saídas{" "}
            <strong className="tabular text-foreground">{formatCurrency(yearOut)}</strong> · {yearLeft < 0 ? "Faltou" : "Sobrou"}{" "}
            <strong className={cn("tabular", yearLeft < 0 ? "text-danger" : "text-positive")}>{formatCurrency(yearLeft)}</strong>
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

      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <MonthCard key={card.month} year={year} card={card} state={stateOf(card.month)} />
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-[12px] text-subtle">
        <Settings2 className="size-3.5" />
        <Link href="/financeiro/cadastros" className="hover:text-foreground hover:underline">
          Configurações
        </Link>
        <span>·</span>
        <Link href="/financeiro/painel" className="hover:text-foreground hover:underline">
          Ferramentas avançadas (gráficos, fluxo de caixa, extrato do banco)
        </Link>
      </p>
    </>
  );
}
