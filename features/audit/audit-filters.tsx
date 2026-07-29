"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/field";

const ENTITIES = [
  { value: "financial_entries", label: "Lançamentos" },
  { value: "entry_broker_splits", label: "Repasses" },
  { value: "brokers", label: "Corretores" },
  { value: "monthly_closings", label: "Fechamentos mensais" },
  { value: "organization_settings", label: "Configurações" },
  { value: "organization_members", label: "Usuários" },
  { value: "entry_imports", label: "Importações" },
];

const ACTIONS = [
  { value: "create", label: "Criação" },
  { value: "update", label: "Edição" },
  { value: "delete", label: "Exclusão" },
  { value: "restore", label: "Restauração" },
  { value: "financial_exception_confirmed", label: "Exceção financeira" },
];

export function AuditFiltersBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    params.delete("pagina");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasFilters = ["de", "ate", "entidade", "acao"].some((key) => searchParams.get(key));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="date"
        aria-label="Data inicial"
        className="w-auto"
        defaultValue={searchParams.get("de") ?? ""}
        onChange={(event) => update({ de: event.target.value })}
      />
      <span className="text-[13px] text-subtle">até</span>
      <Input
        type="date"
        aria-label="Data final"
        className="w-auto"
        defaultValue={searchParams.get("ate") ?? ""}
        onChange={(event) => update({ ate: event.target.value })}
      />

      <NativeSelect
        aria-label="Entidade"
        className="w-auto min-w-44"
        value={searchParams.get("entidade") ?? ""}
        onChange={(event) => update({ entidade: event.target.value || null })}
      >
        <option value="">Todas as entidades</option>
        {ENTITIES.map((entity) => (
          <option key={entity.value} value={entity.value}>
            {entity.label}
          </option>
        ))}
      </NativeSelect>

      <NativeSelect
        aria-label="Ação"
        className="w-auto min-w-40"
        value={searchParams.get("acao") ?? ""}
        onChange={(event) => update({ acao: event.target.value || null })}
      >
        <option value="">Todas as ações</option>
        {ACTIONS.map((action) => (
          <option key={action.value} value={action.value}>
            {action.label}
          </option>
        ))}
      </NativeSelect>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update({ de: null, ate: null, entidade: null, acao: null })}
        >
          <X />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
