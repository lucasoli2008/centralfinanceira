"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PeriodFilter } from "@/components/finance/period-filter";
import { NativeSelect } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { FIN_NATURE_LABELS } from "@/lib/formatting/labels";
import { FIN_NATURES } from "@/lib/validation/finance";
import type { FinAccountRow, FinCategoryRow, FinRegime } from "@/types/database";

/** Atualiza parâmetros da URL preservando os demais (e voltando à página 1). */
export function useUpdateSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return React.useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (!("pagina" in changes)) params.delete("pagina");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
}

const REGIME_OPTIONS: { value: FinRegime; label: string }[] = [
  { value: "caixa", label: "Caixa" },
  { value: "competencia", label: "Competência" },
];

/**
 * Filtros globais do Controle Financeiro: período, regime, conta, categoria e
 * natureza. Ficam na URL para que um link compartilhado mostre os mesmos números.
 */
export function FinanceFilters({
  years,
  accounts,
  categories,
  showRegime = true,
  showCategory = true,
}: {
  years: number[];
  accounts: FinAccountRow[];
  categories?: FinCategoryRow[];
  showRegime?: boolean;
  showCategory?: boolean;
}) {
  const searchParams = useSearchParams();
  const update = useUpdateSearchParams();
  const regime = (searchParams.get("regime") === "competencia" ? "competencia" : "caixa") as FinRegime;
  const hasExtra = ["conta", "categoria", "natureza"].some((key) => searchParams.get(key));

  const groups = (categories ?? []).filter((category) => !category.parent_id);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <PeriodFilter years={years} />

      {showRegime ? (
        <Segmented
          ariaLabel="Regime de apuração"
          options={REGIME_OPTIONS}
          value={regime}
          onChange={(value) => update({ regime: value === "caixa" ? null : value })}
        />
      ) : null}

      <NativeSelect
        aria-label="Conta financeira"
        className="w-auto min-w-40"
        value={searchParams.get("conta") ?? ""}
        onChange={(event) => update({ conta: event.target.value || null })}
      >
        <option value="">Todas as contas</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
            {account.is_active ? "" : " (inativa)"}
          </option>
        ))}
      </NativeSelect>

      {showCategory && categories ? (
        <NativeSelect
          aria-label="Categoria"
          className="w-auto min-w-44"
          value={searchParams.get("categoria") ?? ""}
          onChange={(event) => update({ categoria: event.target.value || null })}
        >
          <option value="">Todas as categorias</option>
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              <option value={group.id}>{group.name} (grupo inteiro)</option>
              {categories
                .filter((category) => category.parent_id === group.id)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
      ) : null}

      <NativeSelect
        aria-label="Natureza da operação"
        className="w-auto min-w-40"
        value={searchParams.get("natureza") ?? ""}
        onChange={(event) => update({ natureza: event.target.value || null })}
      >
        <option value="">Todas as naturezas</option>
        {FIN_NATURES.map((nature) => (
          <option key={nature} value={nature}>
            {FIN_NATURE_LABELS[nature]}
          </option>
        ))}
      </NativeSelect>

      {hasExtra ? (
        <Button variant="ghost" size="sm" onClick={() => update({ conta: null, categoria: null, natureza: null })}>
          <X />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
