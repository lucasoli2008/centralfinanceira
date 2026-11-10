import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatMonthYear, todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { getFinLookups } from "@/server/queries/finance";
import { listPeriodCloses } from "@/server/queries/finance-reports";
import { getMonthSimple } from "@/server/queries/finance-month";
import { MonthExpenses, MonthIncomes } from "@/features/finance/month-simple";
import { QuickEntryButton } from "@/features/finance/quick-entry-sheet";

function parsePeriod(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return {
    year,
    month,
    from: `${match[1]}-${match[2]}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function shiftPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function generateMetadata({ params }: { params: Promise<{ periodo: string }> }): Promise<Metadata> {
  const period = parsePeriod((await params).periodo);
  return { title: period ? formatMonthYear(period.year, period.month) : "Mês" };
}

export default async function FinanceMonthPage({ params }: { params: Promise<{ periodo: string }> }) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const period = parsePeriod((await params).periodo);
  if (!period) notFound();
  const { year, month, from, to } = period;
  const today = todayInTimezone();
  const isCurrent = today >= from && today <= to;

  const [lookups, closes, { incomes, expenses }] = await Promise.all([getFinLookups(), listPeriodCloses(year), getMonthSimple(from, to)]);
  const closed = closes.some((item) => item.month === month && !item.reopened_at);

  const totalIn = incomes.reduce((sum, item) => sum + item.own, 0);
  const totalOut = expenses.reduce((sum, item) => sum + item.amount, 0);
  const paidOut = expenses.filter((item) => item.status === "settled").reduce((sum, item) => sum + item.amount, 0);
  const toPay = totalOut - paidOut;
  const left = totalIn - totalOut;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Mês anterior">
            <Link href={`/financeiro/mes/${shiftPeriod(year, month, -1)}`}>
              <ChevronLeft />
            </Link>
          </Button>
          <div>
            <Link href={year === Number(today.slice(0, 4)) ? "/financeiro" : `/financeiro?ano=${year}`} className="text-[12px] text-muted hover:underline">
              ← Todos os meses de {year}
            </Link>
            <h1 className="flex items-center gap-2 text-[24px] font-semibold capitalize leading-tight">
              {formatMonthYear(year, month)}
              {closed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-semibold normal-case text-positive">
                  <Lock className="size-3" /> Fechado
                </span>
              ) : isCurrent ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold normal-case text-accent">Mês atual</span>
              ) : null}
            </h1>
          </div>
          <Button asChild variant="ghost" size="icon" aria-label="Próximo mês">
            <Link href={`/financeiro/mes/${shiftPeriod(year, month, 1)}`}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <Button asChild variant="secondary">
          <a href={`/api/financeiro/relatorios?tipo=mes&ano=${year}&mes=${month}`} target="_blank" rel="noopener">
            <FileText />
            Relatório do mês (PDF)
          </a>
        </Button>
      </div>

      {/* Os três números do mês */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-[12px] font-medium text-subtle">Entradas</p>
          <p className="text-[24px] font-semibold tabular text-info">{formatCurrency(totalIn)}</p>
          <p className="text-[11.5px] text-subtle">O que ficou para a imobiliária</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-[12px] font-medium text-subtle">Saídas</p>
          <p className="text-[24px] font-semibold tabular">{formatCurrency(totalOut)}</p>
          <p className="text-[11.5px] text-subtle">{toPay > 0 ? `${formatCurrency(toPay)} ainda a pagar` : "Tudo pago"}</p>
        </div>
        <div className={cn("rounded-2xl border px-5 py-4", left < 0 ? "border-danger/30 bg-danger-soft/40" : "border-positive/30 bg-positive-soft/40")}>
          <p className="text-[12px] font-medium text-subtle">{left < 0 ? "Faltou" : "Sobrou"}</p>
          <p className={cn("text-[24px] font-semibold tabular", left < 0 ? "text-danger" : "text-positive")}>{formatCurrency(left)}</p>
          <p className="text-[11.5px] text-subtle">Entradas − saídas</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <section className="surface-card overflow-hidden xl:col-span-3">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[16px] font-semibold">Saídas</h2>
              <p className="text-[12px] text-muted">Gastos do mês, organizados por tipo.</p>
            </div>
            {canWrite && !closed ? <QuickEntryButton lookups={lookups} defaultDate={isCurrent ? today : from} label="Nova saída" /> : null}
          </header>
          <MonthExpenses expenses={expenses} canWrite={canWrite} locked={closed} />
        </section>

        <section className="surface-card overflow-hidden xl:col-span-2">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-[16px] font-semibold">Entradas</h2>
              <p className="text-[12px] text-muted">Comissões marcadas como recebidas entram sozinhas.</p>
            </div>
            {canWrite && !closed ? (
              <QuickEntryButton lookups={lookups} defaultDate={isCurrent ? today : from} defaultKind="income" label="Outra entrada" />
            ) : null}
          </header>
          <MonthIncomes incomes={incomes} />
        </section>
      </div>
    </>
  );
}
