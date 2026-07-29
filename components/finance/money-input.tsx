"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClasses } from "@/components/ui/field";
import { formatDecimal, parseCurrencyInput, parsePercentInput } from "@/lib/formatting/number";

interface NumericFieldProps {
  id?: string;
  name?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

interface Draft {
  /** Texto exatamente como está no campo. */
  text: string;
  /** Valor externo que gerou este texto, para detectar mudanças de fora. */
  source: number | null;
}

/**
 * Campo numérico com máscara tolerante.
 *
 * Enquanto está focado, respeita o que a pessoa digitou; ao perder o foco (ou
 * quando o valor muda por fora — reset do formulário, duplicação de lançamento)
 * reformata no padrão brasileiro. O ajuste é feito comparando estado durante a
 * renderização, sem efeito e sem ref.
 */
function useNumericDraft(
  value: number | null | undefined,
  format: (value: number | null | undefined) => string,
) {
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => ({
    text: format(value),
    source: value ?? null,
  }));

  const external = value ?? null;

  if (!focused && draft.source !== external) {
    setDraft({ text: format(value), source: external });
  }

  return { focused, setFocused, draft, setDraft, external };
}

export function MoneyInput({
  id,
  name,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder = "0,00",
  className,
  ...aria
}: NumericFieldProps) {
  const { setFocused, draft, setDraft } = useNumericDraft(value, formatMoney);

  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-subtle"
      >
        R$
      </span>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        className={cn(controlClasses, "h-9 pl-8 tabular")}
        value={draft.text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const parsed = parseCurrencyInput(event.target.value);
          setDraft({ text: event.target.value, source: parsed });
          onChange(parsed);
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseCurrencyInput(draft.text);
          setDraft({ text: formatMoney(parsed), source: parsed });
          onChange(parsed);
          onBlur?.();
        }}
        {...aria}
      />
    </div>
  );
}

/** Entrada percentual em pontos percentuais: 6 => 6%, 5,5 => 5,5%. */
export function PercentInput({
  id,
  name,
  value,
  onChange,
  onBlur,
  disabled,
  placeholder = "0",
  className,
  ...aria
}: NumericFieldProps) {
  const { setFocused, draft, setDraft } = useNumericDraft(value, formatRate);

  return (
    <div className={cn("relative", className)}>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        className={cn(controlClasses, "h-9 pr-7 tabular")}
        value={draft.text}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const parsed = parsePercentInput(event.target.value);
          setDraft({ text: event.target.value, source: parsed });
          onChange(parsed);
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parsePercentInput(draft.text);
          setDraft({ text: formatRate(parsed), source: parsed });
          onChange(parsed);
          onBlur?.();
        }}
        {...aria}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-subtle"
      >
        %
      </span>
    </div>
  );
}

function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : formatDecimal(value);
}

/** Percentual usa vírgula decimal, como todo número em pt-BR. */
function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(".", ",");
}
