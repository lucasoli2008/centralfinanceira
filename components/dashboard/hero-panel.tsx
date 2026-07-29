import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/finance/sparkline";
import { InfoTooltip } from "@/components/ui/tooltip";
import { formatCurrency, formatInteger, formatPercent, formatVariation } from "@/lib/formatting/number";

interface HeroPanelProps {
  periodLabel: string;
  netRevenue: number;
  grossCommission: number;
  brokerPayout: number;
  entriesCount: number;
  netMargin: number | null;
  variation: number | null;
  comparisonLabel?: string;
  /** Receita líquida dos últimos 12 meses, para a tendência. */
  trend: number[];
  className?: string;
}

/**
 * Indicador principal do dashboard.
 *
 * É o único elemento de alto contraste da interface — a resposta para "quanto
 * sobrou para a imobiliária" precisa ser lida em menos de um segundo.
 */
export function HeroPanel({
  periodLabel,
  netRevenue,
  grossCommission,
  brokerPayout,
  entriesCount,
  netMargin,
  variation,
  comparisonLabel,
  trend,
  className,
}: HeroPanelProps) {
  const isNegative = netRevenue < 0;

  return (
    <section className={cn("surface-hero dot-grid flex flex-col justify-between", className)}>
      <div className="relative px-6 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/60">
              Receita líquida da imobiliária
            </h2>
            <InfoTooltip
              label="Como calculamos a receita líquida"
              content="Comissão bruta do período menos a soma de todos os repasses aos corretores, cada valor arredondado individualmente para duas casas."
            />
          </div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/75">
            {periodLabel}
          </span>
        </div>

        <p
          className={cn(
            "display-number mt-2.5",
            isNegative ? "text-[color-mix(in_srgb,var(--danger)_45%,white)]" : "text-white",
          )}
        >
          {formatCurrency(netRevenue)}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
          <HeroVariation variation={variation} />
          {comparisonLabel ? (
            <span className="text-white/50">vs. {comparisonLabel}</span>
          ) : null}
          {netMargin !== null ? (
            <>
              <span className="text-white/25" aria-hidden="true">
                ·
              </span>
              <span className="text-white/60">
                margem de <span className="font-semibold text-white/85">{formatPercent(netMargin)}</span>
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Tendência dos últimos 12 meses */}
      <div className="relative -mb-px mt-4 px-1 text-white/85">
        <Sparkline values={trend} height={54} stroke="currentColor" strokeWidth={2} />
      </div>

      {/* Composição do resultado */}
      <dl className="relative grid grid-cols-3 border-t border-white/12 bg-black/10">
        <HeroStat
          label="Comissão bruta"
          value={formatCurrency(grossCommission)}
          hint="Vendas + locações"
        />
        <HeroStat
          label="Repasses"
          value={`− ${formatCurrency(brokerPayout)}`}
          hint="Aos corretores"
          divider
        />
        <HeroStat
          label="Entradas"
          value={formatInteger(entriesCount)}
          hint="Lançamentos no período"
          divider
        />
      </dl>
    </section>
  );
}

function HeroStat({
  label,
  value,
  hint,
  divider = false,
}: {
  label: string;
  value: string;
  hint: string;
  divider?: boolean;
}) {
  return (
    <div className={cn("px-4 py-3", divider && "border-l border-white/12")}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-white/45">
        {label}
      </dt>
      <dd className="mt-1 text-[15px] font-semibold tabular text-white">{value}</dd>
      <dd className="text-[11px] text-white/40">{hint}</dd>
    </div>
  );
}

function HeroVariation({ variation }: { variation: number | null }) {
  if (variation === null) {
    return <span className="text-white/45">Sem período anterior para comparação</span>;
  }

  const isNeutral = variation === 0;
  const Icon = isNeutral ? Minus : variation > 0 ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px] font-semibold",
        isNeutral
          ? "bg-white/10 text-white/70"
          : variation > 0
            ? "bg-white/15 text-white"
            : "bg-[color-mix(in_srgb,var(--danger)_35%,transparent)] text-white",
      )}
    >
      <Icon className="size-3" strokeWidth={2.75} />
      {formatVariation(variation)}
    </span>
  );
}
