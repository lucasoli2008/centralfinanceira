"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, Loader2, MoreHorizontal, Paperclip, Plus, Search, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, NativeSelect } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { FIN_ENTRY_KIND_LABELS, FIN_ENTRY_STATUS_LABELS, FIN_ENTRY_STATUS_TONES } from "@/lib/formatting/labels";
import { cn } from "@/lib/utils";
import { bulkCategorizeFinEntries } from "./actions";
import { useUpdateSearchParams } from "./finance-filters";
import { SettleDialog, type SettleTarget } from "./settle-dialog";
import { EntrySheet } from "./entry-sheet";
import type { FinEntryDetailRow, FinEntryKind } from "@/types/database";
import type { FinLookups } from "@/server/queries/finance";

type Mode = "ledger" | "payables" | "receivables";

const STATUS_FILTERS: Record<Mode, { value: string; label: string }[]> = {
  ledger: [
    { value: "", label: "Todos os status" },
    { value: "pending", label: "Pendentes" },
    { value: "overdue", label: "Vencidos" },
    { value: "settled", label: "Liquidados" },
    { value: "forecast", label: "Previstos" },
    { value: "cancelled", label: "Cancelados" },
  ],
  payables: [
    { value: "pending", label: "A pagar" },
    { value: "overdue", label: "Vencidas" },
    { value: "forecast", label: "Previstas" },
    { value: "settled", label: "Pagas" },
    { value: "", label: "Todas" },
  ],
  receivables: [
    { value: "pending", label: "A receber" },
    { value: "overdue", label: "Em atraso" },
    { value: "forecast", label: "Previstos" },
    { value: "settled", label: "Recebidos" },
    { value: "", label: "Todos" },
  ],
};

function signedAmount(row: FinEntryDetailRow, accountId: string | null): number {
  if (row.kind === "income") return row.amount;
  if (row.kind === "expense") return -row.amount;
  if (row.kind === "adjustment") return row.adjustment_direction === "increase" ? row.amount : -row.amount;
  // Transferência: positiva para a conta de destino quando o filtro é por conta.
  if (accountId && row.transfer_account_id === accountId) return row.amount;
  if (accountId && row.account_id === accountId) return -row.amount;
  return 0;
}

export function EntriesTable({
  rows,
  total,
  page,
  pageSize,
  lookups,
  canWrite,
  mode = "ledger",
  defaultStatus = "",
  newKind = "expense",
}: {
  rows: FinEntryDetailRow[];
  total: number;
  page: number;
  pageSize: number;
  lookups: FinLookups;
  canWrite: boolean;
  mode?: Mode;
  defaultStatus?: string;
  newKind?: FinEntryKind;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const update = useUpdateSearchParams();
  const [search, setSearch] = React.useState(searchParams.get("busca") ?? "");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = React.useState("");
  const [bulkPending, setBulkPending] = React.useState(false);
  const [settleTarget, setSettleTarget] = React.useState<SettleTarget | null>(null);
  const [creating, setCreating] = React.useState(searchParams.get("novo") === "1");

  const accountFilter = searchParams.get("conta");
  const status = searchParams.get("status") ?? defaultStatus;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  React.useEffect(() => {
    const current = searchParams.get("busca") ?? "";
    if (search === current) return;
    const timeout = setTimeout(() => update({ busca: search || null }), 350);
    return () => clearTimeout(timeout);
  }, [search, searchParams, update]);

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lancamento", id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeCreate() {
    setCreating(false);
    if (searchParams.get("novo")) update({ novo: null });
  }

  const selectable = rows.filter((row) => (row.kind === "income" || row.kind === "expense") && row.status !== "cancelled" && !row.operation_id);
  const allSelected = selectable.length > 0 && selectable.every((row) => selected.includes(row.id));

  async function applyBulk() {
    if (!bulkCategory) return;
    setBulkPending(true);
    const result = await bulkCategorizeFinEntries(selected, bulkCategory);
    setBulkPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(`${result.data.updated} lançamento(s) recategorizado(s).`);
    setSelected([]);
    setBulkCategory("");
    router.refresh();
  }

  const pageTotal = rows.reduce((sum, row) => sum + (row.status === "cancelled" ? 0 : signedAmount(row, accountFilter)), 0);
  const pageRemaining = rows.reduce((sum, row) => sum + (row.status === "cancelled" ? 0 : row.remaining_amount), 0);
  const groups = lookups.categories.filter((category) => !category.parent_id);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            className="pl-8"
            placeholder="Buscar descrição, favorecido ou documento"
            aria-label="Buscar lançamentos"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {mode === "ledger" ? (
          <NativeSelect
            aria-label="Tipo"
            className="w-auto min-w-36"
            value={searchParams.get("tipo") ?? ""}
            onChange={(event) => update({ tipo: event.target.value || null })}
          >
            <option value="">Todos os tipos</option>
            {(["income", "expense", "transfer", "adjustment"] as const).map((kind) => (
              <option key={kind} value={kind}>
                {FIN_ENTRY_KIND_LABELS[kind]}
              </option>
            ))}
          </NativeSelect>
        ) : null}

        <NativeSelect
          aria-label="Situação"
          className="w-auto min-w-36"
          value={status}
          onChange={(event) => update({ status: event.target.value === defaultStatus ? null : event.target.value || (defaultStatus ? "todos" : null) })}
        >
          {STATUS_FILTERS[mode].map((option) => (
            <option key={option.label} value={option.value === "" && defaultStatus ? "todos" : option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Favorecido"
          className="w-auto min-w-40"
          value={searchParams.get("favorecido") ?? ""}
          onChange={(event) => update({ favorecido: event.target.value || null })}
        >
          <option value="">Todos os favorecidos</option>
          {lookups.counterparties.map((counterparty) => (
            <option key={counterparty.id} value={counterparty.id}>
              {counterparty.name}
            </option>
          ))}
        </NativeSelect>

        <div className="ml-auto flex gap-2">
          {canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {mode === "payables" ? "Nova conta a pagar" : mode === "receivables" ? "Nova conta a receber" : "Novo lançamento"}
            </Button>
          ) : null}
        </div>
      </div>

      {selected.length > 0 && canWrite ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-control border border-accent-border bg-accent-soft px-3 py-2 text-[13px]">
          <Tags className="size-3.5 text-accent" />
          <span className="font-medium">{selected.length} selecionado(s)</span>
          <NativeSelect
            aria-label="Nova categoria"
            className="h-8 w-auto min-w-52 text-[12.5px]"
            value={bulkCategory}
            onChange={(event) => setBulkCategory(event.target.value)}
          >
            <option value="">Mover para a categoria…</option>
            {groups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {lookups.categories
                  .filter((category) => category.parent_id === group.id)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </NativeSelect>
          <Button size="sm" onClick={applyBulk} disabled={!bulkCategory || bulkPending}>
            {bulkPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Aplicar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            <X />
            Limpar seleção
          </Button>
        </div>
      ) : null}

      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon="search"
            title={
              mode === "payables"
                ? "Nenhuma conta a pagar com estes filtros."
                : mode === "receivables"
                  ? "Nenhuma conta a receber com estes filtros."
                  : "Nenhum lançamento encontrado."
            }
            description={
              mode === "ledger"
                ? "Ajuste o período ou os filtros, ou registre o primeiro lançamento."
                : "Contas registradas sem baixa aparecem aqui até serem quitadas."
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Lançamentos financeiros</caption>
              <THead>
                <TR>
                  {canWrite ? (
                    <TH className="w-9">
                      <Checkbox
                        aria-label="Selecionar todos"
                        checked={allSelected}
                        onChange={(event) => setSelected(event.target.checked ? selectable.map((row) => row.id) : [])}
                      />
                    </TH>
                  ) : null}
                  <TH>{mode === "ledger" ? "Competência" : "Vencimento"}</TH>
                  <TH>Descrição</TH>
                  <TH>Categoria</TH>
                  <TH>{mode === "ledger" ? "Conta" : "Favorecido"}</TH>
                  <TH>Situação</TH>
                  <TH numeric>Valor</TH>
                  {mode !== "ledger" ? <TH numeric>Em aberto</TH> : null}
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const value = signedAmount(row, accountFilter);
                  const isTitle = row.kind === "income" || row.kind === "expense";
                  const pending = isTitle && ["open", "partial", "forecast"].includes(row.status);
                  const canSelect = selectable.some((item) => item.id === row.id);
                  return (
                    <TR key={row.id} className={cn(row.status === "cancelled" && "opacity-55")}>
                      {canWrite ? (
                        <TD>
                          <Checkbox
                            aria-label={`Selecionar ${row.description}`}
                            disabled={!canSelect}
                            checked={selected.includes(row.id)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                              )
                            }
                          />
                        </TD>
                      ) : null}
                      <TD className="whitespace-nowrap tabular">
                        {formatDate(mode === "ledger" ? row.competence_date : row.reference_date)}
                        {mode !== "ledger" && row.is_overdue ? (
                          <span className="block text-[11px] font-medium text-danger">Vencido</span>
                        ) : null}
                      </TD>
                      <TD className="max-w-[320px]">
                        <button
                          type="button"
                          onClick={() => openDetail(row.id)}
                          className={cn(
                            "block truncate text-left font-medium hover:text-accent hover:underline",
                            row.status === "cancelled" && "line-through",
                          )}
                        >
                          {row.description}
                        </button>
                        <span className="flex items-center gap-1.5 text-[11.5px] text-subtle">
                          {FIN_ENTRY_KIND_LABELS[row.kind]}
                          {mode === "ledger" && row.counterparty_name ? ` · ${row.counterparty_name}` : ""}
                          {row.attachments_count > 0 ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Paperclip className="size-3" />
                              {row.attachments_count}
                            </span>
                          ) : null}
                        </span>
                      </TD>
                      <TD className="text-muted">
                        {row.category_name ??
                          (row.kind === "transfer" ? `${row.account_name} → ${row.transfer_account_name}` : row.kind === "adjustment" ? "Ajuste de saldo" : "—")}
                      </TD>
                      <TD className="text-muted">{mode === "ledger" ? (row.kind === "transfer" ? "—" : row.account_name ?? "—") : row.counterparty_name ?? "—"}</TD>
                      <TD>
                        <Badge tone={FIN_ENTRY_STATUS_TONES[row.status]}>{FIN_ENTRY_STATUS_LABELS[row.status]}</Badge>
                        {mode === "ledger" && row.is_overdue ? (
                          <Badge tone="danger" className="ml-1">
                            Vencido
                          </Badge>
                        ) : null}
                      </TD>
                      <TD
                        numeric
                        className={cn(
                          "font-medium",
                          mode === "ledger" && value > 0 && "text-info",
                        )}
                      >
                        {mode === "ledger"
                          ? row.kind === "transfer" && !accountFilter
                            ? formatCurrency(row.amount)
                            : `${value < 0 ? "−" : value > 0 ? "+" : ""}${formatCurrency(Math.abs(value))}`
                          : formatCurrency(row.amount)}
                      </TD>
                      {mode !== "ledger" ? (
                        <TD numeric className="font-semibold">
                          {formatCurrency(row.status === "cancelled" ? 0 : row.remaining_amount)}
                        </TD>
                      ) : null}
                      <TD>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações de ${row.description}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => openDetail(row.id)}>
                              <Eye />
                              Ver detalhes
                            </DropdownMenuItem>
                            {canWrite && pending ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  setSettleTarget({
                                    id: row.id,
                                    kind: row.kind as "income" | "expense",
                                    description: row.description,
                                    remaining: row.remaining_amount,
                                    accountId: row.account_id,
                                    paymentMethod: row.payment_method,
                                    isForecast: row.is_forecast,
                                  })
                                }
                              >
                                {row.kind === "income" ? "Registrar recebimento" : "Registrar pagamento"}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={canWrite ? 6 : 5}>
                    Total desta página ({rows.filter((row) => row.status !== "cancelled").length} lançamentos)
                  </TD>
                  <TD numeric className="font-semibold">
                    {mode === "ledger" ? `${pageTotal < 0 ? "−" : ""}${formatCurrency(Math.abs(pageTotal))}` : formatCurrency(rows.reduce((s, r) => s + (r.status === "cancelled" ? 0 : r.amount), 0))}
                  </TD>
                  {mode !== "ledger" ? (
                    <TD numeric className="font-semibold">
                      {formatCurrency(pageRemaining)}
                    </TD>
                  ) : null}
                  <TD />
                </TR>
              </TFoot>
            </Table>
          </TableWrapper>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="Paginação">
          <p className="text-muted">
            Página {page} de {totalPages} · {total} lançamentos
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ pagina: String(page - 1) })}>
              Anterior
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => update({ pagina: String(page + 1) })}>
              Próxima
            </Button>
          </div>
        </nav>
      ) : null}

      <SettleDialog target={settleTarget} accounts={lookups.accounts} onClose={() => setSettleTarget(null)} />

      {creating ? (
        <EntrySheet
          open
          onOpenChange={(open) => !open && closeCreate()}
          lookups={lookups}
          initialKind={newKind}
          defaultValues={mode === "ledger" ? undefined : { settleNow: false }}
          title={mode === "payables" ? "Nova conta a pagar" : mode === "receivables" ? "Nova conta a receber" : undefined}
        />
      ) : null}
    </>
  );
}
