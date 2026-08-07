"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/components/finance/period-filter";
import { WORK_CATEGORY_LABELS, WORK_STATUS_LABELS } from "@/lib/formatting/labels";
import { WORK_CATEGORIES, WORK_STATUSES } from "@/lib/validation/work";

export function WorksFilters({ years }: { years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState(searchParams.get("busca") ?? "");

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("pagina");
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const current = searchParams.get("busca") ?? "";
    if (search === current) return;
    const timeout = setTimeout(() => update({ busca: search || null }), 350);
    return () => clearTimeout(timeout);
  }, [search, searchParams, update]);

  const hasFilters =
    Boolean(searchParams.get("busca")) ||
    Boolean(searchParams.get("status")) ||
    Boolean(searchParams.get("categoria"));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          className="pl-8"
          placeholder="Buscar por título, imóvel, endereço ou proprietário"
          aria-label="Buscar obras"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <PeriodFilter years={years} />

      <NativeSelect
        aria-label="Status"
        className="w-auto min-w-40"
        value={searchParams.get("status") ?? ""}
        onChange={(event) => update({ status: event.target.value || null })}
      >
        <option value="">Todos os status</option>
        {WORK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {WORK_STATUS_LABELS[status]}
          </option>
        ))}
      </NativeSelect>

      <NativeSelect
        aria-label="Categoria"
        className="w-auto min-w-40"
        value={searchParams.get("categoria") ?? ""}
        onChange={(event) => update({ categoria: event.target.value || null })}
      >
        <option value="">Todas as categorias</option>
        {WORK_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {WORK_CATEGORY_LABELS[category]}
          </option>
        ))}
      </NativeSelect>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            update({ busca: null, status: null, categoria: null });
          }}
        >
          <X />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
