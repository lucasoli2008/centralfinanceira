"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import type { EntryTotals } from "@/lib/finance/types";
import { baseAmountShortLabel } from "@/lib/formatting/labels";
import type { EntryType } from "@/lib/finance/types";

interface SummaryPanelProps {
  entryType: EntryType;
  baseAmount: number | null | undefined;
  totals: EntryTotals;
  className?: string;
}

/** Resumo financeiro em tempo real do formulário de lançamento. */
export function SummaryPanel({ entryType, baseAmount, totals, className }: SummaryPanelProps) {
  const rows = [
    { label: baseAmountShortLabel(entryType), value: formatCurrency(baseAmount ?? 0) },
    { label: "Comissão bruta", value: formatCurrency(totals.grossCommission) },
    { label: "Total de repasses", value: `− ${formatCurrency(totals.totalBrokerPayout)}` },
  ];

  return (
    <div className={cn("surface-card p-5", className)}>
      <h2 className="section-title">Resumo financeiro</h2>
      <p className="mt-1 text-xs text-subtle">
        Atualizado enquanto você preenche. Os valores são confirmados no servidor ao salvar.
      </p>

      <dl className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-muted">{row.label}</dt>
            <dd className="text-[13px] font-medium tabular">{row.value}</dd>
          </div>
        ))}

        <div className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] font-medium">Receita líquida</dt>
            <dd
              className={cn(
                "text-lg font-semibold tabular",
                totals.isNegativeNet ? "text-danger" : "text-accent",
              )}
            >
              {formatCurrency(totals.netCompanyRevenue)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <dt className="text-xs text-muted">Margem líquida</dt>
            <dd className="text-xs tabular text-muted">
              {totals.netMargin === null ? "Sem base para cálculo" : formatPercent(totals.netMargin)}
            </dd>
          </div>
        </div>
      </dl>

      {totals.isNegativeNet ? (
        <p className="mt-4 flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          A soma dos repasses é maior que a comissão bruta. Será necessário confirmar a exceção
          financeira com justificativa.
        </p>
      ) : null}
    </div>
  );
}
