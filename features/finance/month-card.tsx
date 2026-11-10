import Link from "next/link";
import { ArrowUpRight, CalendarClock, FileWarning, Lock } from "lucide-react";
import { formatCompactCurrency, formatCurrency } from "@/lib/formatting/number";
import { monthName } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import type { FinYearCardRow } from "@/types/database";

export type MonthState = "current" | "past" | "future";

/** Cartão de um mês na visão do ano: resultado, entradas × saídas e pendências. */
export function MonthCard({
  year,
  card,
  state,
  scale,
}: {
  year: number;
  card: FinYearCardRow;
  state: MonthState;
  /** Maior valor de entrada/saída do ano — as barras são proporcionais a ele. */
  scale: number;
}) {
  const href = `/financeiro/mes/${year}-${String(card.month).padStart(2, "0")}`;
  const hasMovement = card.cash_in > 0 || card.cash_out > 0 || card.revenue > 0 || card.expenses > 0;
  const width = (value: number) => (scale > 0 ? `${Math.max(value > 0 ? 4 : 0, Math.round((value / scale) * 100))}%` : "0%");
  const status = card.is_closed
    ? { label: "Fechado", tone: "bg-positive-soft text-positive", icon: Lock }
    : state === "current"
      ? { label: "Mês atual", tone: "bg-accent-soft text-accent", icon: CalendarClock }
      : state === "future"
        ? { label: "Futuro", tone: "bg-surface-muted text-subtle", icon: null }
        : { label: "Aberto", tone: "bg-warning-soft text-warning", icon: null };
  const StatusIcon = status.icon;

  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-[200px] flex-col rounded-2xl border bg-surface p-4 shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        state === "current" ? "border-accent-border ring-1 ring-accent-border" : "border-border hover:border-border-strong",
        state === "future" && !hasMovement && "bg-surface-sunken/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{year}</p>
          <p className="text-[17px] font-semibold capitalize leading-tight">{monthName(card.month)}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", status.tone)}>
          {StatusIcon ? <StatusIcon className="size-3" /> : null}
          {status.label}
        </span>
      </div>

      {hasMovement ? (
        <>
          <div className="mt-3">
            <p className="text-[11px] text-subtle">Resultado do mês</p>
            <p className={cn("text-[22px] font-semibold leading-tight tabular", card.result < 0 ? "text-danger" : "text-positive")}>
              {formatCurrency(card.result)}
            </p>
          </div>

          <div className="mt-3 space-y-1.5" aria-hidden="true">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="w-12 text-subtle">Entrou</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full rounded-full bg-info" style={{ width: width(card.cash_in) }} />
              </span>
              <span className="w-16 text-right tabular text-muted">{formatCompactCurrency(card.cash_in)}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="w-12 text-subtle">Saiu</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full rounded-full bg-[var(--foreground-subtle)]" style={{ width: width(card.cash_out) }} />
              </span>
              <span className="w-16 text-right tabular text-muted">{formatCompactCurrency(card.cash_out)}</span>
            </div>
          </div>
          <p className="sr-only">
            Entrou {formatCurrency(card.cash_in)}, saiu {formatCurrency(card.cash_out)}.
          </p>
        </>
      ) : (
        <p className="mt-4 flex-1 text-[12.5px] text-subtle">
          {state === "future" ? "Nada lançado ainda. Recorrências aparecem aqui como previsão." : "Sem lançamentos neste mês."}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {card.payables_count > 0 ? (
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted">
            {card.payables_count} a pagar · {formatCompactCurrency(card.payables_amount)}
          </span>
        ) : null}
        {card.receivables_count > 0 ? (
          <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] text-info">
            {card.receivables_count} a receber · {formatCompactCurrency(card.receivables_amount)}
          </span>
        ) : null}
        {card.statement_pending > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning">
            <FileWarning className="size-3" />
            {card.statement_pending} no extrato
          </span>
        ) : null}
      </div>

      <ArrowUpRight className="absolute bottom-4 right-4 size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
