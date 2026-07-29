"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableWrapper,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, Input } from "@/components/ui/field";
import { EntriesFilters, type ColumnOption } from "./entries-filters";
import { deleteEntry } from "./actions";
import { usePersistedState } from "@/lib/use-persisted-state";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { PROPERTY_TYPE_LABELS } from "@/lib/formatting/labels";
import type { EntryType } from "@/lib/finance/types";
import type { BrokerRow, EntryTotalsRow } from "@/types/database";

const STORAGE_PREFIX = "central-financeira:colunas:";

interface EntriesTableProps {
  entryType: EntryType;
  rows: EntryTotalsRow[];
  authors: Record<string, string>;
  brokers: BrokerRow[];
  years: number[];
  totals: {
    baseAmount: number;
    grossCommission: number;
    brokerPayout: number;
    netRevenue: number;
  };
  page: number;
  pageSize: number;
  total: number;
}

export function EntriesTable({
  entryType,
  rows,
  authors,
  brokers,
  years,
  totals,
  page,
  pageSize,
  total,
}: EntriesTableProps) {
  const router = useRouter();
  const basePath = entryType === "sale" ? "/vendas" : "/locacoes";
  const baseLabel = entryType === "sale" ? "Valor da venda" : "Primeiro aluguel";

  const columns: ColumnOption[] = React.useMemo(
    () => [
      { id: "entry_date", label: "Data", alwaysVisible: true },
      { id: "description", label: "Descrição", alwaysVisible: true },
      { id: "reference", label: "Referência" },
      { id: "property_type", label: "Tipo do imóvel" },
      { id: "base_amount", label: baseLabel },
      { id: "commission", label: "Comissão" },
      { id: "gross_commission", label: "Comissão bruta" },
      { id: "brokers", label: "Corretores" },
      { id: "broker_payout", label: "Total de repasses" },
      { id: "net_revenue", label: "Receita líquida" },
      { id: "created_by", label: "Criado por" },
    ],
    [baseLabel],
  );

  const defaultColumns = React.useMemo(
    () =>
      columns
        .filter((column) => column.id !== "created_by" && column.id !== "reference")
        .map((column) => column.id),
    [columns],
  );

  // A escolha de colunas fica salva por tipo de lançamento.
  const [visibleColumns, updateColumns] = usePersistedState<string[]>(
    `${STORAGE_PREFIX}${entryType}`,
    defaultColumns,
  );

  const isVisible = (id: string) => visibleColumns.includes(id);
  const [deleting, setDeleting] = React.useState<EntryTotalsRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteEntry(deleting.entry_id, reason || undefined);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Lançamento movido para a lixeira.");
    setDeleting(null);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <EntriesFilters
        brokers={brokers}
        years={years}
        columns={columns}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={updateColumns}
      />

      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={
              entryType === "sale"
                ? "Nenhuma venda registrada neste período."
                : "Nenhuma locação registrada neste período."
            }
            description={
              entryType === "sale"
                ? "Registre a primeira entrada de comissão de venda para começar a acompanhar os resultados."
                : "Registre a primeira entrada de comissão de locação para começar a acompanhar os resultados."
            }
            actionLabel={entryType === "sale" ? "Registrar venda" : "Registrar locação"}
            actionHref={`${basePath}/nova`}
            icon="search"
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">
                {entryType === "sale" ? "Lançamentos de venda" : "Lançamentos de locação"} do
                período selecionado
              </caption>
              <THead>
                <TR>
                  {isVisible("entry_date") ? <TH>Data</TH> : null}
                  {isVisible("description") ? <TH>Descrição</TH> : null}
                  {isVisible("reference") ? <TH>Referência</TH> : null}
                  {isVisible("property_type") ? <TH>Tipo</TH> : null}
                  {isVisible("base_amount") ? <TH numeric>{baseLabel}</TH> : null}
                  {isVisible("commission") ? <TH numeric>Comissão</TH> : null}
                  {isVisible("gross_commission") ? <TH numeric>Comissão bruta</TH> : null}
                  {isVisible("brokers") ? <TH>Corretores</TH> : null}
                  {isVisible("broker_payout") ? <TH numeric>Repasses</TH> : null}
                  {isVisible("net_revenue") ? <TH numeric>Receita líquida</TH> : null}
                  {isVisible("created_by") ? <TH>Criado por</TH> : null}
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>

              <TBody>
                {rows.map((row) => (
                  <TR key={row.entry_id}>
                    {isVisible("entry_date") ? (
                      <TD className="whitespace-nowrap tabular">{formatDate(row.entry_date)}</TD>
                    ) : null}

                    {isVisible("description") ? (
                      <TD>
                        <Link
                          href={`${basePath}/${row.entry_id}`}
                          className="font-medium hover:text-accent hover:underline"
                        >
                          {row.description}
                        </Link>
                        {row.exception_confirmed ? (
                          <Badge tone="danger" className="ml-2">
                            Exceção
                          </Badge>
                        ) : null}
                      </TD>
                    ) : null}

                    {isVisible("reference") ? (
                      <TD className="text-muted">{row.reference ?? "—"}</TD>
                    ) : null}

                    {isVisible("property_type") ? (
                      <TD>{PROPERTY_TYPE_LABELS[row.property_type]}</TD>
                    ) : null}

                    {isVisible("base_amount") ? (
                      <TD numeric>{formatCurrency(row.base_amount)}</TD>
                    ) : null}

                    {isVisible("commission") ? (
                      <TD numeric>
                        {row.commission_mode === "percentage"
                          ? formatPercent(row.commission_rate)
                          : `Fixa · ${formatCurrency(row.commission_fixed_amount)}`}
                      </TD>
                    ) : null}

                    {isVisible("gross_commission") ? (
                      <TD numeric className="font-medium">
                        {formatCurrency(row.gross_commission)}
                      </TD>
                    ) : null}

                    {isVisible("brokers") ? (
                      <TD>
                        {row.broker_names?.length ? (
                          <span className="text-muted">
                            {row.broker_names.join(", ")}
                          </span>
                        ) : (
                          <span className="text-subtle">Sem corretor</span>
                        )}
                      </TD>
                    ) : null}

                    {isVisible("broker_payout") ? (
                      <TD numeric>{formatCurrency(row.total_broker_payout)}</TD>
                    ) : null}

                    {isVisible("net_revenue") ? (
                      <TD
                        numeric
                        className={
                          row.net_company_revenue < 0
                            ? "font-medium text-danger"
                            : "font-medium"
                        }
                      >
                        {formatCurrency(row.net_company_revenue)}
                      </TD>
                    ) : null}

                    {isVisible("created_by") ? (
                      <TD className="text-muted">
                        {row.created_by ? (authors[row.created_by] ?? "—") : "—"}
                      </TD>
                    ) : null}

                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ações do lançamento ${row.description}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem asChild>
                            <Link href={`${basePath}/${row.entry_id}`}>
                              <Eye />
                              Ver detalhes
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`${basePath}/${row.entry_id}/editar`}>
                              <Pencil />
                              Editar
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`${basePath}/nova?duplicar=${row.entry_id}`}>
                              <Copy />
                              Duplicar
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setDeleting(row)}>
                            <Trash2 />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>

              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={visibleColumns.filter((id) => !isNumericColumn(id)).length}>
                    Total do período
                  </TD>
                  {isVisible("base_amount") ? (
                    <TD numeric>{formatCurrency(totals.baseAmount)}</TD>
                  ) : null}
                  {isVisible("commission") ? <TD numeric>—</TD> : null}
                  {isVisible("gross_commission") ? (
                    <TD numeric>{formatCurrency(totals.grossCommission)}</TD>
                  ) : null}
                  {isVisible("brokers") ? <TD /> : null}
                  {isVisible("broker_payout") ? (
                    <TD numeric>{formatCurrency(totals.brokerPayout)}</TD>
                  ) : null}
                  {isVisible("net_revenue") ? (
                    <TD numeric>{formatCurrency(totals.netRevenue)}</TD>
                  ) : null}
                  {isVisible("created_by") ? <TD /> : null}
                  <TD />
                </TR>
              </TFoot>
            </Table>
          </TableWrapper>
        )}
      </div>

      {totalPages > 1 ? (
        <nav
          className="mt-4 flex items-center justify-between text-[13px]"
          aria-label="Paginação dos lançamentos"
        >
          <p className="text-muted">
            Página {page} de {totalPages} · {total} lançamentos
          </p>
          <div className="flex gap-2">
            <PageLink page={page - 1} disabled={page <= 1} label="Anterior" />
            <PageLink page={page + 1} disabled={page >= totalPages} label="Próxima" />
          </div>
        </nav>
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento</DialogTitle>
            <DialogDescription>
              O lançamento sai dos totais e vai para a lixeira, onde pode ser restaurado. A ação
              fica registrada na auditoria.
            </DialogDescription>
          </DialogHeader>

          <FormField label="Motivo" htmlFor="delete-reason" hint="Opcional.">
            <Input
              id="delete-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Lançamento duplicado"
            />
          </FormField>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              Excluir lançamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isNumericColumn(id: string) {
  return ["base_amount", "commission", "gross_commission", "broker_payout", "net_revenue", "brokers", "created_by"].includes(
    id,
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={() => {
        const params = new URLSearchParams(window.location.search);
        params.set("pagina", String(page));
        router.push(`${window.location.pathname}?${params.toString()}`);
      }}
    >
      {label}
    </Button>
  );
}
