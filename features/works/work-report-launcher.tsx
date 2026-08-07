"use client";

import * as React from "react";
import { FileDown, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect } from "@/components/ui/field";
import { buildSearchParams } from "@/lib/utils";
import { WORK_CATEGORIES, WORK_STATUSES } from "@/lib/validation/work";
import { WORK_CATEGORY_LABELS, WORK_STATUS_LABELS } from "@/lib/formatting/labels";

export function WorkReportLauncher() {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [includeArchived, setIncludeArchived] = React.useState(false);

  function hrefFor(formato: "pdf" | "csv") {
    return `/api/obras/relatorios${buildSearchParams({
      formato,
      de: from,
      ate: to,
      status,
      categoria: category,
      arquivadas: includeArchived ? "1" : null,
    })}`;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="De" htmlFor="relatorio-obras-de">
          <Input
            id="relatorio-obras-de"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </FormField>
        <FormField label="Até" htmlFor="relatorio-obras-ate">
          <Input
            id="relatorio-obras-ate"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Status" htmlFor="relatorio-obras-status">
          <NativeSelect
            id="relatorio-obras-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Todos os status</option>
            {WORK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {WORK_STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Categoria" htmlFor="relatorio-obras-categoria">
          <NativeSelect
            id="relatorio-obras-categoria"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Todas as categorias</option>
            {WORK_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {WORK_CATEGORY_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          className="size-3.5"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        Incluir obras arquivadas
      </label>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={hrefFor("pdf")} target="_blank" rel="noopener noreferrer">
            <FileDown />
            Gerar PDF
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={hrefFor("csv")} target="_blank" rel="noopener noreferrer">
            <Sheet />
            Exportar CSV
          </a>
        </Button>
      </div>
    </div>
  );
}
