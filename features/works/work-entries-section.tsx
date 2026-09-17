"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
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
import { WorkEntryDialog } from "./work-entry-dialog";
import { deleteWorkEntry, setWorkEntryPaid } from "./actions";
import { formatCurrency, formatDecimal } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { WORK_ENTRY_TYPE_LABELS, WORK_ENTRY_UNIT_LABELS } from "@/lib/formatting/labels";
import { cn } from "@/lib/utils";
import type { WorkEntryFormValues } from "@/lib/validation/work";
import type { WorkAttachmentRow, WorkEntryRow, WorkEntryType } from "@/types/database";
import type { WorkTotals } from "@/lib/works/types";

const ENTRY_TYPE_TONES = {
  material: "neutral",
  servico: "accent",
  outro_custo: "warning",
} as const;

const ENTRY_TYPE_ORDER: WorkEntryType[] = ["servico", "material", "outro_custo"];

const ENTRY_TYPE_PLURAL: Record<WorkEntryType, string> = {
  servico: "Serviços",
  material: "Materiais",
  outro_custo: "Outros custos",
};

type DialogTarget = { mode: "new" } | { mode: "edit"; entry: WorkEntryRow } | { mode: "duplicate"; entry: WorkEntryRow };

function toFormValues(entry: WorkEntryRow, workId: string): Partial<WorkEntryFormValues> {
  return {
    workId,
    entryType: entry.entry_type,
    entryDate: entry.entry_date,
    description: entry.description,
    category: entry.category ?? "",
    supplierName: entry.supplier_name ?? "",
    quantity: entry.quantity,
    unit: entry.unit,
    unitPrice: entry.unit_price,
    totalAmount: entry.total_amount,
    totalIsManual: entry.total_is_manual,
    isPaid: entry.is_paid,
    paidAt: entry.paid_at ?? "",
    notes: entry.notes ?? "",
  };
}

export function WorkEntriesSection({
  workId,
  entries,
  totals,
  suppliers,
  attachments,
  attachmentCounts,
  readOnly = false,
}: {
  workId: string;
  entries: WorkEntryRow[];
  totals: WorkTotals;
  suppliers: string[];
  attachments: WorkAttachmentRow[];
  attachmentCounts: Record<string, number>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [dialogTarget, setDialogTarget] = React.useState<DialogTarget | null>(null);
  const [deleting, setDeleting] = React.useState<WorkEntryRow | null>(null);
  const [pending, setPending] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

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

  async function togglePaid(entry: WorkEntryRow, isPaid: boolean) {
    setTogglingId(entry.id);
    const result = await setWorkEntryPaid(entry.id, workId, isPaid);
    setTogglingId(null);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(isPaid ? "Pagamento registrado." : "Pagamento desmarcado.");
    router.refresh();
  }

  const groups = ENTRY_TYPE_ORDER.map((type) => ({
    type,
    rows: entries.filter((entry) => entry.entry_type === type),
    subtotal:
      type === "servico" ? totals.servicesTotal : type === "material" ? totals.materialsTotal : totals.otherTotal,
  }));

  const dialogEntry = dialogTarget && dialogTarget.mode !== "new" ? dialogTarget.entry : null;
  const linkedAttachments = dialogTarget?.mode === "edit"
    ? attachments.filter((attachment) => attachment.work_entry_id === dialogTarget.entry.id)
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Custos, materiais e serviços</h2>
          <p className="text-[12.5px] text-muted">
            Total {formatCurrency(totals.grandTotal)} · Pago {formatCurrency(totals.paidTotal)} · A pagar{" "}
            <span className={cn(totals.unpaidTotal > 0 && "font-medium text-warning")}>
              {formatCurrency(totals.unpaidTotal)}
            </span>
          </p>
        </div>
        {readOnly ? null : (
          <Button size="sm" onClick={() => setDialogTarget({ mode: "new" })}>
            <Plus />
            Adicionar item
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="surface-card overflow-hidden">
          <EmptyState
            title="Nenhum item lançado ainda."
            description="Adicione materiais, serviços ou outros custos desta obra."
            icon="inbox"
          />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.type} className="surface-card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Badge tone={ENTRY_TYPE_TONES[group.type]}>{WORK_ENTRY_TYPE_LABELS[group.type]}</Badge>
                <span className="text-[13px] font-medium">{ENTRY_TYPE_PLURAL[group.type]}</span>
                <span className="text-[12px] text-subtle">
                  {group.rows.length} {group.rows.length === 1 ? "item" : "itens"}
                </span>
              </div>
              <span className="text-[13px] font-semibold tabular">{formatCurrency(group.subtotal)}</span>
            </header>

            {group.rows.length === 0 ? (
              <p className="px-4 py-3 text-[12.5px] text-subtle">Nenhum item deste tipo.</p>
            ) : (
              <TableWrapper>
                <Table>
                  <caption className="sr-only">{ENTRY_TYPE_PLURAL[group.type]} desta obra</caption>
                  <THead>
                    <TR>
                      <TH>Data</TH>
                      <TH>Descrição</TH>
                      <TH>Fornecedor</TH>
                      <TH numeric>Qtd.</TH>
                      <TH numeric>Valor unit.</TH>
                      <TH numeric>Total</TH>
                      <TH className="w-20 text-center">Pago</TH>
                      <TH className="w-10">
                        <span className="sr-only">Ações</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {group.rows.map((entry) => {
                      const clipCount = attachmentCounts[entry.id] ?? 0;
                      return (
                        <TR key={entry.id}>
                          <TD className="whitespace-nowrap tabular">{formatDate(entry.entry_date)}</TD>
                          <TD>
                            <span className="font-medium">{entry.description}</span>
                            {entry.category ? (
                              <span className="ml-2 text-xs text-subtle">{entry.category}</span>
                            ) : null}
                            {clipCount > 0 ? (
                              <span
                                className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent"
                                title={`${clipCount} ${clipCount === 1 ? "anexo vinculado" : "anexos vinculados"}`}
                              >
                                <Paperclip className="size-2.5" />
                                {clipCount}
                              </span>
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
                          <TD className="text-center">
                            <label
                              className="inline-flex cursor-pointer flex-col items-center gap-0.5"
                              title={entry.is_paid && entry.paid_at ? `Pago em ${formatDate(entry.paid_at)}` : "Marcar como pago"}
                            >
                              <Checkbox
                                checked={entry.is_paid}
                                disabled={readOnly || togglingId === entry.id}
                                onChange={(event) => togglePaid(entry, event.target.checked)}
                                aria-label={`${entry.description}: ${entry.is_paid ? "pago" : "não pago"}`}
                              />
                              {entry.is_paid && entry.paid_at ? (
                                <span className="text-[10.5px] tabular text-subtle">{formatDate(entry.paid_at)}</span>
                              ) : null}
                            </label>
                          </TD>
                          <TD>
                            {readOnly ? null : (
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
                                  <DropdownMenuItem onSelect={() => setDialogTarget({ mode: "edit", entry })}>
                                    <Pencil />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setDialogTarget({ mode: "duplicate", entry })}>
                                    <Copy />
                                    Duplicar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem destructive onSelect={() => setDeleting(entry)}>
                                    <Trash2 />
                                    Remover
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                  <TFoot>
                    <TR className="hover:bg-transparent">
                      <TD colSpan={5}>Subtotal · {ENTRY_TYPE_PLURAL[group.type].toLowerCase()}</TD>
                      <TD numeric className="font-semibold">
                        {formatCurrency(group.subtotal)}
                      </TD>
                      <TD colSpan={2} />
                    </TR>
                  </TFoot>
                </Table>
              </TableWrapper>
            )}
          </section>
        ))
      )}

      {entries.length > 0 ? (
        <div className="surface-card grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <p className="label-caption">Total geral</p>
            <p className="mt-0.5 text-lg font-semibold tabular">{formatCurrency(totals.grandTotal)}</p>
          </div>
          <div>
            <p className="label-caption">Pago</p>
            <p className="mt-0.5 text-lg font-semibold tabular text-positive">{formatCurrency(totals.paidTotal)}</p>
          </div>
          <div>
            <p className="label-caption">A pagar</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular", totals.unpaidTotal > 0 ? "text-warning" : "")}>
              {formatCurrency(totals.unpaidTotal)}
            </p>
          </div>
        </div>
      ) : null}

      {dialogTarget ? (
        <WorkEntryDialog
          key={dialogTarget.mode === "new" ? "new" : `${dialogTarget.mode}-${dialogTarget.entry.id}`}
          open
          onOpenChange={(open) => !open && setDialogTarget(null)}
          workId={workId}
          suppliers={suppliers}
          entryId={dialogTarget.mode === "edit" ? dialogTarget.entry.id : undefined}
          duplicating={dialogTarget.mode === "duplicate"}
          linkedAttachments={linkedAttachments}
          defaultValues={
            dialogEntry
              ? {
                  ...toFormValues(dialogEntry, workId),
                  ...(dialogTarget.mode === "duplicate"
                    ? { entryDate: new Date().toISOString().slice(0, 10), isPaid: false, paidAt: "" }
                    : {}),
                }
              : undefined
          }
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
