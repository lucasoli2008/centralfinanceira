"use client";

import * as React from "react";
import { AlertTriangle, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Money } from "@/components/finance/money";
import { formatPercent } from "@/lib/formatting/number";
import type { EntryTotals } from "@/lib/finance/types";
import { baseAmountShortLabel } from "@/lib/formatting/labels";
import type { EntryType } from "@/lib/finance/types";

interface SummaryPanelProps {
  entryType: EntryType;
  baseAmount: number | null | undefined;
  totals: EntryTotals;
  className?: string;
}

/**
 * Resumo financeiro em tempo real do formulário de lançamento.
 *
 * Tratado como um "recibo": valor-base e comissão em segundo plano, receita
 * líquida em destaque com hierarquia tipográfica de dinheiro (Money), e a
 * margem sempre visível — igual a um extrato bancário.
 */
export function SummaryPanel({ entryType, baseAmount, totals, className }: SummaryPanelProps) {
  return (
    <div className={cn("surface-raised overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken px-5 py-3">
        <Receipt className="size-3.5 text-subtle" />
        <h2 className="section-title">Resumo financeiro</h2>
      </div>

      <div className="space-y-2.5 px-5 pb-4 pt-4">
        <Row label={baseAmountShortLabel(entryType)} value={baseAmount ?? 0} />
        <Row label="Comissão bruta" value={totals.grossCommission} />
        <Row label="Total de repasses" value={totals.totalBrokerPayout} negative />
      </div>

      <div className="border-t border-dashed border-border-strong px-5 py-4">
        <p className="label-caption">Receita líquida</p>
        <Money
          value={totals.netCompanyRevenue}
          size="display"
          colorBySign
          className="mt-0.5 block !text-[2rem]"
        />
        <p className="mt-1.5 text-[11.5px] text-subtle">
          Margem líquida:{" "}
          <span className="font-semibold text-muted">
            {totals.netMargin === null ? "sem base para cálculo" : formatPercent(totals.netMargin)}
          </span>
        </p>
      </div>

      {totals.isNegativeNet ? (
        <div className="flex items-start gap-2 border-t border-danger/20 bg-danger-soft px-5 py-3 text-[12px] leading-snug text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Os repasses superam a comissão bruta. Será preciso confirmar a exceção financeira com
          justificativa para salvar.
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="text-[13px] font-medium">
        <Money value={value} size="inherit" forceNegativeSign={negative} className="font-medium" />
      </dd>
    </div>
  );
}
