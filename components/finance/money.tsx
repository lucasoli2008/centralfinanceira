import * as React from "react";
import { cn } from "@/lib/utils";
import { currencyParts, formatCurrency } from "@/lib/formatting/number";

type MoneySize = "display" | "xl" | "lg" | "md" | "sm" | "inherit";

interface MoneyProps {
  value: number | string | null | undefined;
  size?: MoneySize;
  /** Mostra o sinal + para valores positivos (usado em variações). */
  showPositiveSign?: boolean;
  /** Colore conforme o sinal: verde para positivo, vermelho para negativo. */
  colorBySign?: boolean;
  /** Ex.: "− R$ 12.000,00" no resumo de repasses. */
  forceNegativeSign?: boolean;
  className?: string;
}

const SIZES: Record<MoneySize, string> = {
  display: "display-number",
  xl: "text-[1.5rem] leading-8 font-semibold tracking-[-0.03em]",
  lg: "text-[1.0625rem] leading-6 font-semibold tracking-[-0.02em]",
  md: "text-[13px] font-semibold",
  sm: "text-[12px] font-medium",
  inherit: "",
};

/**
 * Valor monetário com hierarquia interna — a assinatura tipográfica de produto
 * financeiro: símbolo e centavos recuam, os reais dominam a leitura.
 *
 *   R$ 150.875,00   ->   ʀ$ ***150.875***,00
 *
 * Sempre com números tabulares, para colunas não "dançarem".
 */
export function Money({
  value,
  size = "md",
  showPositiveSign = false,
  colorBySign = false,
  forceNegativeSign = false,
  className,
}: MoneyProps) {
  const parts = currencyParts(value);

  if (!parts) {
    return (
      <span className={cn("tabular text-subtle", SIZES[size], className)} aria-label="sem valor">
        —
      </span>
    );
  }

  const { negative, integer, cents } = parts;
  const sign = negative || forceNegativeSign ? "−" : showPositiveSign ? "+" : "";

  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        SIZES[size],
        colorBySign && (negative ? "text-danger" : "text-positive"),
        className,
      )}
      // Leitores de tela recebem o valor completo e sem ambiguidade.
      aria-label={`${negative || forceNegativeSign ? "menos " : ""}${formatCurrency(
        Math.abs(Number(value ?? 0)),
      )}`}
    >
      {sign ? <span aria-hidden="true">{sign}&#8239;</span> : null}
      <span aria-hidden="true" className="opacity-55" style={{ fontSize: "0.72em" }}>
        R$&#8239;
      </span>
      <span aria-hidden="true">{integer}</span>
      <span aria-hidden="true" className="opacity-55" style={{ fontSize: "0.72em" }}>
        ,{cents}
      </span>
    </span>
  );
}

/**
 * Variação percentual em chip, no padrão de extrato bancário.
 * Verde para o que é bom, vermelho para o que é ruim — com `invert` para
 * métricas em que crescer é ruim (repasses, por exemplo).
 */
export function DeltaChip({
  value,
  invert = false,
  size = "md",
  className,
}: {
  value: number | null | undefined;
  invert?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const isNeutral = value === 0;
  const isGood = invert ? value < 0 : value > 0;
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  })
    .format(value)
    .replace("-", "−");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular",
        size === "sm" ? "px-1.5 py-px text-[10.5px]" : "px-1.5 py-0.5 text-[11.5px]",
        isNeutral
          ? "bg-surface-muted text-muted"
          : isGood
            ? "bg-positive-soft text-positive"
            : "bg-danger-soft text-danger",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          isNeutral ? "bg-subtle" : isGood ? "bg-positive" : "bg-danger",
        )}
      />
      {formatted}%
    </span>
  );
}
