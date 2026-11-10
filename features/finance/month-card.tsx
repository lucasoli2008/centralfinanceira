import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import { formatCurrency } from "@/lib/formatting/number";
import { monthName } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import type { FinYearCardRow } from "@/types/database";

export type MonthState = "current" | "past" | "future";

/** Caixinha de um mês: entradas, saídas e quanto sobrou. Clique abre o mês. */
export function MonthCard({
  year,
  card,
  forecast,
  state,
}: {
  year: number;
  card: FinYearCardRow;
  /** Recorrências ainda não pagas do mês (estimativa). */
  forecast?: { expenses: number; incomes: number };
  state: MonthState;
}) {
  const href = `/financeiro/mes/${year}-${String(card.month).padStart(2, "0")}`;
  const incomes = card.revenue + (forecast?.incomes ?? 0);
  const expenses = card.expenses + (forecast?.expenses ?? 0);
  const estimated = (forecast?.expenses ?? 0) + (forecast?.incomes ?? 0) > 0;
  const hasMovement = incomes !== 0 || expenses !== 0;
  const left = incomes - expenses;

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-[190px] flex-col rounded-2xl border bg-surface p-5 shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        state === "current" ? "border-accent-border ring-2 ring-accent-border" : "border-border hover:border-border-strong",
        state === "future" && !hasMovement && "bg-surface-sunken/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[18px] font-semibold capitalize leading-tight">{monthName(card.month)}</p>
        {card.is_closed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[10.5px] font-semibold text-positive">
            <Lock className="size-3" /> Fechado
          </span>
        ) : state === "current" ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold text-accent">Mês atual</span>
        ) : null}
      </div>

      {hasMovement ? (
        <dl className="mt-4 space-y-1.5 text-[13px]">
          <div className="flex items-center justify-between">
            <dt className="text-muted">Entradas</dt>
            <dd className="font-semibold tabular text-info">{formatCurrency(incomes)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted">Saídas</dt>
            <dd className="font-semibold tabular">{formatCurrency(expenses)}</dd>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <dt className="font-medium">{left < 0 ? (estimated ? "Vai faltar" : "Faltou") : estimated ? "Deve sobrar" : "Sobrou"}</dt>
            <dd className={cn("text-[16px] font-semibold tabular", left < 0 ? "text-danger" : "text-positive")}>{formatCurrency(left)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 flex-1 text-[12.5px] text-subtle">
          {state === "future"
            ? card.payables_count > 0
              ? `${card.payables_count} conta(s) fixa(s) prevista(s)`
              : "Nada lançado ainda."
            : "Sem lançamentos. Clique para cadastrar as saídas."}
        </p>
      )}

      {estimated ? (
        <p className="mt-2 text-[11px] text-subtle">Inclui {formatCurrency(forecast?.expenses ?? 0)} em contas fixas previstas</p>
      ) : null}

      {card.payables_count > 0 && hasMovement && !estimated ? (
        <p className="mt-auto pt-3 text-[11.5px] text-warning">
          {card.payables_count} a pagar · {formatCurrency(card.payables_amount)}
        </p>
      ) : null}

      <ArrowUpRight className="absolute bottom-4 right-4 size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
