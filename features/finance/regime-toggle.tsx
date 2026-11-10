"use client";

import { useSearchParams } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
import { useUpdateSearchParams } from "./finance-filters";
import type { FinRegime } from "@/types/database";

/** Alterna o regime na URL (?regime=). O padrão varia por tela. */
export function RegimeToggle({ defaultRegime }: { defaultRegime: FinRegime }) {
  const searchParams = useSearchParams();
  const update = useUpdateSearchParams();
  const raw = searchParams.get("regime");
  const value: FinRegime = raw === "caixa" || raw === "competencia" ? raw : defaultRegime;
  return (
    <Segmented
      ariaLabel="Regime de apuração"
      options={[
        { value: "competencia", label: "Competência" },
        { value: "caixa", label: "Caixa" },
      ]}
      value={value}
      onChange={(next) => update({ regime: next === defaultRegime ? null : next })}
    />
  );
}

/** Opções simples em segmentos gravadas na URL (horizonte, agrupamento...). */
export function ParamSegmented<T extends string>({
  param,
  options,
  value,
  defaultValue,
  ariaLabel,
}: {
  param: string;
  options: { value: T; label: string }[];
  value: T;
  defaultValue: T;
  ariaLabel: string;
}) {
  const update = useUpdateSearchParams();
  return (
    <Segmented
      ariaLabel={ariaLabel}
      options={options}
      value={value}
      onChange={(next) => update({ [param]: next === defaultValue ? null : next })}
    />
  );
}
