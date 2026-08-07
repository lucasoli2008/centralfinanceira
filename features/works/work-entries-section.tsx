"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { WorkEntryDialog } from "./work-entry-dialog";
import { deleteWorkEntry } from "./actions";
import { formatCurrency, formatDecimal } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { WORK_ENTRY_TYPE_LABELS, WORK_ENTRY_UNIT_LABELS } from "@/lib/formatting/labels";
import type { WorkEntryFormValues } from "@/lib/validation/work";
import type { WorkEntryRow } from "@/types/database";
import type { WorkTotals } from "@/lib/works/types";

const ENTRY_TYPE_TONES = {
  material: "neutral",
  servico: "accent",
  outro_custo: "warning",
} as const;

export function WorkEntriesSection({
  workId,
  entries,
  totals,
  suppliers,
}: {
  workId: string;
  entries: WorkEntryRow[];
  totals: WorkTotals;
  suppliers: string[];
}) {
  const router = useRouter();
  const [dialogTarget, setDialogTarget] = React.useState<"new" | WorkEntryRow | null>(null);
  const [deleting, setDeleting] = React.useState<WorkEntryRow | null>(null);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteWorkEntry(deleting.id, workId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Item removido.");
    setDeleting(null);
    router.refresh();
  }

  const editDefaultValues: Partial<WorkEntryFormValues> | undefined =
    dialogTarget && dialogTarget !== "new"
      ? {
          workId,
          entryType: dialogTarget.entry_type,
          entryDate: dialogTarget.entry_date,
          description: dialogTarget.description,
          category: dialogTarget.category ?? "",
          supplierName: dialogTarget.supplier_name ?? "",
          quantity: dialogTarget.quantity,
          unit: dialogTarget.unit,
          unitPrice: dialogTarget.unit_price,
          totalAmount: dialogTarget.total_amount,
          totalIsManual: dialogTarget.total_is_manual,
          notes: dialogTarget.notes ?? "",
        }
      : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title">Custos, materiais e serviços</h2>
          <p className="text-[12.5px] text-muted">Total geral: {formatCurrency(totals.grandTotal)}</p>
        </div>
        <Button size="sm" onClick={() => setDialogTarget("new")}>
          <Plus />
          Adicionar item
        </Button>
      </div>

      <div className="surface-card overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState
            title="Nenhum item lançado ainda."
            description="Adicione materiais, serviços ou outros custos desta obra."
            actionLabel="Adicionar item"
            icon="inbox"
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Itens de custo desta obra</caption>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Tipo</TH>
                  <TH>Descrição</TH>
                  <TH>Fornecedor</TH>
                  <TH numeric>Qtd.</TH>
                  <TH numeric>Valor unit.</TH>
                  <TH numeric>Total</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(entry.entry_date)}</TD>
                    <TD>
                      <Badge tone={ENTRY_TYPE_TONES[entry.entry_type]}>
                        {WORK_ENTRY_TYPE_LABELS[entry.entry_type]}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-medium">{entry.description}</span>
                      {entry.category ? (
                        <span className="ml-2 text-xs text-subtle">{entry.category}</span>
                      ) : null}
                    </TD>
                    <TD className="text-muted">{entry.supplier_name ?? "—"}</TD>
                    <TD numeric className="tabular">
                      {formatDecimal(entry.quantity)} {WORK_ENTRY_UNIT_LABELS[entry.unit]}
                    </TD>
                    <TD numeric className="tabular">
                      {formatCurrency(entry.unit_price)}
                    </TD>
                    <TD numeric className="font-medium tabular">
                      {formatCurrency(entry.total_amount)}
                      {entry.total_is_manual ? (
                        <span className="ml-1 text-xs text-subtle">(manual)</span>
                      ) : null}
                    </TD>
                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Ações do item ${entry.description}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDialogTarget(entry)}>
                            <Pencil />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem destructive onSelect={() => setDeleting(entry)}>
                            <Trash2 />
                            Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR className="hover:bg-transparent">
                  <TD colSpan={6}>Total geral</TD>
                  <TD numeric className="font-semibold">
                    {formatCurrency(totals.grandTotal)}
                  </TD>
                  <TD />
                </TR>
              </TFoot>
            </Table>
          </TableWrapper>
        )}
      </div>

      {dialogTarget ? (
        <WorkEntryDialog
          key={dialogTarget === "new" ? "new" : dialogTarget.id}
          open
          onOpenChange={(open) => !open && setDialogTarget(null)}
          workId={workId}
          suppliers={suppliers}
          entryId={dialogTarget === "new" ? undefined : dialogTarget.id}
          defaultValues={editDefaultValues}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover item</DialogTitle>
            <DialogDescription>
              O item sai dos totais desta obra. A ação fica registrada no histórico.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              Remover item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
