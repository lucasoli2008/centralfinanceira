import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVariation } from "@/lib/formatting/number";
import { InfoTooltip } from "@/components/ui/tooltip";

interface MetricCardProps {
  label: string;
  value: string;
  /** Variação percentual contra o período anterior; null quando não há base. */
  variation?: number | null;
  comparisonLabel?: string;
  formula?: string;
  hint?: string;
  emphasis?: boolean;
  /** Para métricas em que crescer é ruim (ex.: repasses). */
  invertVariationColor?: boolean;
  className?: string;
}

/** Card de indicador principal. Usar apenas para os KPIs de destaque. */
export function MetricCard({
  label,
  value,
  variation,
  comparisonLabel,
  formula,
  hint,
  emphasis = false,
  invertVariationColor = false,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "surface-card flex flex-col gap-1.5 px-4 py-3.5",
        emphasis && "border-accent-border bg-accent-soft shadow-none",
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className={cn("label-caption leading-snug", emphasis && "text-accent/80")}>
          {label}
        </span>
        {formula ? <InfoTooltip label={`Como calculamos: ${label}`} content={formula} /> : null}
      </div>

      <p className={cn("metric-value", emphasis && "text-accent")}>{value}</p>

      {variation !== undefined ? (
        <VariationBadge
          variation={variation}
          comparisonLabel={comparisonLabel}
          invert={invertVariationColor}
        />
      ) : hint ? (
        <p className="text-[11.5px] leading-snug text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function VariationBadge({
  variation,
  comparisonLabel,
  invert = false,
}: {
  variation: number | null | undefined;
  comparisonLabel?: string;
  invert?: boolean;
}) {
  if (variation === null || variation === undefined) {
    return <p className="text-[11.5px] leading-snug text-subtle">Sem período anterior para comparação</p>;
  }

  const isNeutral = variation === 0;
  const isGood = invert ? variation < 0 : variation > 0;
  const Icon = isNeutral ? Minus : variation > 0 ? ArrowUp : ArrowDown;

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] leading-snug">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1 py-px font-semibold",
          isNeutral
            ? "bg-surface-muted text-muted"
            : isGood
              ? "bg-positive-soft text-positive"
              : "bg-danger-soft text-danger",
        )}
      >
        <Icon className="size-2.5" strokeWidth={2.75} />
        {formatVariation(variation)}
      </span>
      {comparisonLabel ? <span className="text-subtle">vs. {comparisonLabel}</span> : null}
    </p>
  );
}

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
  formula?: string;
  tone?: "default" | "positive" | "danger";
}

/**
 * Grupo compacto de indicadores secundários.
 * Evita a poluição de dezenas de cards idênticos: agrupa por assunto e usa
 * uma lista densa de rótulo/valor.
 */
export function StatGroup({
  title,
  items,
  className,
}: {
  title: string;
  items: StatItem[];
  className?: string;
}) {
  return (
    <div className={cn("surface-card px-4 py-3.5", className)}>
      <p className="label-overline">{title}</p>

      <dl className="mt-2.5 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-baseline justify-between gap-3">
            <dt className="flex items-center gap-1 text-[12.5px] leading-snug text-muted">
              {item.label}
              {item.formula ? (
                <InfoTooltip label={`Como calculamos: ${item.label}`} content={item.formula} />
              ) : null}
            </dt>
            <dd
              className={cn(
                "shrink-0 text-[13px] font-semibold tabular",
                item.tone === "positive" && "text-positive",
                item.tone === "danger" && "text-danger",
              )}
            >
              {item.value}
              {item.hint ? (
                <span className="ml-1 font-normal text-subtle">{item.hint}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
