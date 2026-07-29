import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";
import { MONTH_SHORT_NAMES, monthName } from "@/lib/formatting/date";
import type { MonthlySeriesRow } from "@/types/database";

interface MonthStripProps {
  year: number;
  series: MonthlySeriesRow[];
  closedMonths: Set<number>;
  className?: string;
}

/**
 * Os 12 meses do ano em uma faixa comparável.
 *
 * A altura da barra mostra a receita líquida relativa ao melhor mês, então dá
 * para ler sazonalidade de relance — algo que 12 cards idênticos não entregam.
 */
export function MonthStrip({ year, series, closedMonths, className }: MonthStripProps) {
  const byMonth = new Map(series.map((row) => [row.month, row]));
  const values = series.map((row) => Number(row.total_net_revenue));
  const max = Math.max(...values, 1);
  const bestMonth = series.find((row) => Number(row.total_net_revenue) === max && max > 0)?.month;

  return (
    <div className={cn("grid grid-cols-6 gap-1.5 lg:grid-cols-12", className)}>
      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
        const row = byMonth.get(month);
        const net = Number(row?.total_net_revenue ?? 0);
        const gross = Number(row?.total_gross_commission ?? 0);
        const entries = row?.entries_count ?? 0;
        const hasMovement = entries > 0;
        const share = max > 0 ? Math.max(net / max, 0) : 0;
        const isBest = month === bestMonth;
        const isClosed = closedMonths.has(month);

        return (
          <Link
            key={month}
            href={`/meses/${year}/${month}`}
            aria-label={`${monthName(month)} de ${year}: receita líquida de ${formatCurrency(net)}, ${entries} entradas`}
            className={cn(
              "hover-lift group flex flex-col rounded-control border p-2",
              hasMovement
                ? "border-border bg-surface hover:border-accent-border"
                : "border-dashed border-border bg-surface-sunken",
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-wide",
                  hasMovement ? "text-muted" : "text-subtle",
                )}
              >
                {MONTH_SHORT_NAMES[month - 1]}
              </span>
              {isClosed ? (
                <Lock className="size-2.5 shrink-0 text-warning" aria-hidden="true" />
              ) : null}
            </div>

            {/* Barra proporcional ao melhor mês do ano */}
            <div className="mt-2 flex h-14 items-end" aria-hidden="true">
              <div
                className={cn(
                  "w-full rounded-[3px] transition-colors",
                  net < 0
                    ? "bg-danger"
                    : isBest
                      ? "bg-accent"
                      : hasMovement
                        ? "bg-accent-muted group-hover:bg-accent-border"
                        : "bg-border",
                )}
                style={{ height: `${hasMovement ? Math.max(share * 100, 6) : 3}%` }}
              />
            </div>

            <p
              className={cn(
                "mt-2 truncate text-[12px] font-semibold tabular",
                net < 0 ? "text-danger" : hasMovement ? "text-foreground" : "text-subtle",
              )}
            >
              {hasMovement ? formatCurrency(net) : "—"}
            </p>
            <p className="truncate text-[10.5px] text-subtle">
              {hasMovement
                ? `${formatCurrency(gross)} · ${formatInteger(entries)} ent.`
                : "Sem movimento"}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
