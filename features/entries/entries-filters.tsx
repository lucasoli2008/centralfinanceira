"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/components/finance/period-filter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { BrokerRow } from "@/types/database";

export interface ColumnOption {
  id: string;
  label: string;
  alwaysVisible?: boolean;
}

interface EntriesFiltersProps {
  brokers: BrokerRow[];
  years: number[];
  columns: ColumnOption[];
  visibleColumns: string[];
  onVisibleColumnsChange: (columns: string[]) => void;
}

export function EntriesFilters({
  brokers,
  years,
  columns,
  visibleColumns,
  onVisibleColumnsChange,
}: EntriesFiltersProps) {
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

  // Busca com atraso curto para não disparar uma consulta por tecla.
  React.useEffect(() => {
    const current = searchParams.get("busca") ?? "";
    if (search === current) return;
    const timeout = setTimeout(() => update({ busca: search || null }), 350);
    return () => clearTimeout(timeout);
  }, [search, searchParams, update]);

  const hasFilters =
    Boolean(searchParams.get("busca")) ||
    Boolean(searchParams.get("corretor")) ||
    Boolean(searchParams.get("imovel")) ||
    Boolean(searchParams.get("comissao"));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          className="pl-8"
          placeholder="Buscar por descrição ou referência"
          aria-label="Buscar lançamentos"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <PeriodFilter years={years} />

      <NativeSelect
        aria-label="Corretor"
        className="w-auto min-w-40"
        value={searchParams.get("corretor") ?? ""}
        onChange={(event) => update({ corretor: event.target.value || null })}
      >
        <option value="">Todos os corretores</option>
        {brokers.map((broker) => (
          <option key={broker.id} value={broker.id}>
            {broker.full_name}
          </option>
        ))}
      </NativeSelect>

      <NativeSelect
        aria-label="Tipo do imóvel"
        className="w-auto"
        value={searchParams.get("imovel") ?? ""}
        onChange={(event) => update({ imovel: event.target.value || null })}
      >
        <option value="">Residencial e comercial</option>
        <option value="residential">Residencial</option>
        <option value="commercial">Comercial</option>
      </NativeSelect>

      <NativeSelect
        aria-label="Forma da comissão"
        className="w-auto"
        value={searchParams.get("comissao") ?? ""}
        onChange={(event) => update({ comissao: event.target.value || null })}
      >
        <option value="">Percentual e fixa</option>
        <option value="percentage">Comissão percentual</option>
        <option value="fixed">Comissão fixa</option>
      </NativeSelect>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <SlidersHorizontal />
            Colunas
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-52">
          <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
          {columns.map((column) => (
            <label
              key={column.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                className="size-3.5"
                disabled={column.alwaysVisible}
                checked={visibleColumns.includes(column.id)}
                onChange={(event) => {
                  onVisibleColumnsChange(
                    event.target.checked
                      ? [...visibleColumns, column.id]
                      : visibleColumns.filter((id) => id !== column.id),
                  );
                }}
              />
              {column.label}
            </label>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            update({ busca: null, corretor: null, imovel: null, comissao: null });
          }}
        >
          <X />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
