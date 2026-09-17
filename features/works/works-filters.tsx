"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Search, X } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodFilter } from "@/components/finance/period-filter";
import { WORK_CATEGORY_LABELS, WORK_PRIORITY_LABELS, WORK_STATUS_LABELS } from "@/lib/formatting/labels";
import { WORK_CATEGORIES, WORK_PRIORITIES, WORK_STATUSES } from "@/lib/validation/work";
import { cn } from "@/lib/utils";

const FILTER_KEYS = ["busca", "status", "categoria", "prioridade", "atrasadas"] as const;

export function WorksFilters({ years, showArchivedTabs = true }: { years: number[]; showArchivedTabs?: boolean }) {
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

  const archived = searchParams.get("arquivadas") === "1";
  const overdue = searchParams.get("atrasadas") === "1";
  const hasFilters = FILTER_KEYS.some((key) => Boolean(searchParams.get(key)));

  return (
    <div className="mb-4 space-y-3">
      {showArchivedTabs ? (
        <Tabs
          value={archived ? "arquivadas" : "ativas"}
          onValueChange={(value) => update({ arquivadas: value === "arquivadas" ? "1" : null, atrasadas: null })}
        >
          <TabsList>
            <TabsTrigger value="ativas">Ativas</TabsTrigger>
            <TabsTrigger value="arquivadas">Arquivadas</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
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

        <PeriodFilter years={years} allowAll />

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

        <NativeSelect
          aria-label="Prioridade"
          className="w-auto min-w-36"
          value={searchParams.get("prioridade") ?? ""}
          onChange={(event) => update({ prioridade: event.target.value || null })}
        >
          <option value="">Todas as prioridades</option>
          {WORK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {WORK_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </NativeSelect>

        {archived ? null : (
          <Button
            type="button"
            variant={overdue ? "primary" : "secondary"}
            size="sm"
            aria-pressed={overdue}
            className={cn(!overdue && "text-warning")}
            onClick={() => update({ atrasadas: overdue ? null : "1" })}
          >
            <AlertTriangle />
            Só atrasadas
          </Button>
        )}

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
            }}
          >
            <X />
            Limpar filtros
          </Button>
        ) : null}
      </div>
    </div>
  );
}
