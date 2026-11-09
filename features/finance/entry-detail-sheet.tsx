"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  History,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import {
  FIN_ENTRY_KIND_LABELS,
  FIN_ENTRY_STATUS_LABELS,
  FIN_ENTRY_STATUS_TONES,
  FIN_NATURE_LABELS,
  FIN_OPERATION_KIND_LABELS,
  FIN_ORIGIN_LABELS,
  FIN_PAYMENT_METHOD_LABELS,
} from "@/lib/formatting/labels";
import { cn } from "@/lib/utils";
import {
  cancelFinEntry,
  cancelFinOperation,
  confirmFinForecast,
  deleteFinAttachment,
  reverseFinSettlement,
  uploadFinAttachment,
} from "./actions";
import { EntrySheet, entryToFormValues } from "./entry-sheet";
import { SettleDialog, type SettleTarget } from "./settle-dialog";
import { ReasonDialog } from "./reason-dialog";
import type { FinEntryDetail, FinLookups } from "@/server/queries/finance";
import type { FinAttachmentRow } from "@/types/database";

export type FinAttachmentWithUrl = FinAttachmentRow & { url: string | null };

const HISTORY_ACTIONS: Record<string, string> = {
  create: "Criado",
  update: "Alterado",
  delete: "Removido",
  restore: "Restaurado",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label-caption">{label}</dt>
      <dd className="mt-0.5 text-[13px]">{children ?? "—"}</dd>
    </div>
  );
}

export function EntryDetailSheet({
  detail,
  attachments,
  lookups,
  canWrite,
  onClose,
}: {
  detail: FinEntryDetail;
  attachments: FinAttachmentWithUrl[];
  lookups: FinLookups;
  canWrite: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { entry, settlements, history, operation, related } = detail;
  const [editing, setEditing] = React.useState<"edit" | "duplicate" | null>(null);
  const [settleTarget, setSettleTarget] = React.useState<SettleTarget | null>(null);
  const [reversing, setReversing] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancellingOperation, setCancellingOperation] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const isTitle = entry.kind === "income" || entry.kind === "expense";
  const isOpen = entry.status === "open" || entry.status === "partial" || entry.status === "forecast";
  const locked = Boolean(entry.operation_id) || entry.origin === "opening_balance";
  const cancelled = entry.status === "cancelled";

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("entryId", entry.id);
    const result = await uploadFinAttachment(formData);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Comprovante anexado.");
    router.refresh();
  }

  async function removeAttachment(attachment: FinAttachmentWithUrl) {
    const result = await deleteFinAttachment(attachment.id);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Anexo removido.");
    router.refresh();
  }

  async function confirmForecast() {
    setConfirming(true);
    const result = await confirmFinForecast(entry.id);
    setConfirming(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success("Previsão confirmada. Agora é uma conta em aberto.");
    router.refresh();
  }

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent width="lg" aria-describedby="entry-detail-description">
          <SheetHeader>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={entry.kind === "income" ? "info" : "neutral"}>{FIN_ENTRY_KIND_LABELS[entry.kind]}</Badge>
              <Badge tone={FIN_ENTRY_STATUS_TONES[entry.status]}>{FIN_ENTRY_STATUS_LABELS[entry.status]}</Badge>
              {entry.is_overdue ? <Badge tone="danger">Vencido</Badge> : null}
              {entry.nature ? <Badge tone="neutral">{FIN_NATURE_LABELS[entry.nature]}</Badge> : null}
            </div>
            <SheetTitle className={cn(cancelled && "line-through decoration-subtle")}>{entry.description}</SheetTitle>
            <SheetDescription id="entry-detail-description">
              {FIN_ORIGIN_LABELS[entry.origin]}
              {entry.installment_number ? ` · parcela ${entry.installment_number}/${entry.installment_count}` : ""}
              {" · criado em "}
              {formatDateTime(entry.created_at)}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="space-y-6">
            {/* Valores */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-control border border-border p-3">
                <p className="label-caption">Valor</p>
                <p className="mt-1 text-xl font-semibold tabular">{formatCurrency(entry.amount)}</p>
              </div>
              <div className="rounded-control border border-border p-3">
                <p className="label-caption">{entry.kind === "income" ? "Recebido" : "Pago"}</p>
                <p className="mt-1 text-xl font-semibold tabular">{formatCurrency(entry.settled_amount)}</p>
              </div>
              <div className={cn("rounded-control border p-3", entry.remaining_amount > 0 && isOpen ? "border-warning/40 bg-warning-soft" : "border-border")}>
                <p className="label-caption">Em aberto</p>
                <p className="mt-1 text-xl font-semibold tabular">{formatCurrency(isTitle && !cancelled ? entry.remaining_amount : 0)}</p>
              </div>
            </div>

            {cancelled ? (
              <p className="rounded-control bg-surface-muted px-3 py-2 text-[12.5px] text-muted">
                Cancelado: {entry.cancel_reason}
              </p>
            ) : null}

            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              {isTitle ? (
                <Fact label="Categoria">
                  {entry.category_parent_name ? <span className="text-subtle">{entry.category_parent_name} › </span> : null}
                  {entry.category_name}
                </Fact>
              ) : null}
              <Fact label={entry.kind === "transfer" ? "Origem" : "Conta"}>{entry.account_name}</Fact>
              {entry.kind === "transfer" ? <Fact label="Destino">{entry.transfer_account_name}</Fact> : null}
              {entry.kind === "adjustment" ? (
                <Fact label="Efeito">{entry.adjustment_direction === "increase" ? "Aumenta o saldo" : "Diminui o saldo"}</Fact>
              ) : null}
              {isTitle ? <Fact label="Favorecido">{entry.counterparty_name}</Fact> : null}
              <Fact label={isTitle ? "Competência" : "Data"}>{formatDate(entry.competence_date)}</Fact>
              {isTitle ? <Fact label="Vencimento">{entry.due_date ? formatDate(entry.due_date) : "À vista"}</Fact> : null}
              {isTitle ? (
                <Fact label="Forma de pagamento">
                  {entry.payment_method ? FIN_PAYMENT_METHOD_LABELS[entry.payment_method] : null}
                </Fact>
              ) : null}
              {entry.cost_center_name ? <Fact label="Centro de custo">{entry.cost_center_name}</Fact> : null}
              {entry.property_label ? <Fact label="Imóvel">{entry.property_label}</Fact> : null}
              {entry.document_number ? <Fact label="Documento">{entry.document_number}</Fact> : null}
            </dl>

            {entry.notes ? (
              <div>
                <p className="label-caption">{entry.kind === "adjustment" ? "Justificativa" : "Observações"}</p>
                <p className="mt-1 whitespace-pre-line text-[13px]">{entry.notes}</p>
              </div>
            ) : null}

            {/* Operação imobiliária e lançamentos ligados */}
            {operation || related.length > 0 ? (
              <section className="rounded-card border border-border">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <Link2 className="size-3.5 text-subtle" />
                    {operation ? FIN_OPERATION_KIND_LABELS[operation.kind] : "Parcelas"}
                  </p>
                  {operation && !operation.cancelled_at && canWrite ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancellingOperation(true)}>
                      <XCircle />
                      Cancelar operação
                    </Button>
                  ) : null}
                </header>
                {operation ? (
                  <div className="grid gap-3 border-b border-border px-4 py-3 text-[12.5px] sm:grid-cols-3">
                    <div>
                      <p className="label-caption">Valor que entrou</p>
                      <p className="font-semibold tabular">{formatCurrency(operation.gross_amount)}</p>
                    </div>
                    <div>
                      <p className="label-caption">Da imobiliária</p>
                      <p className="font-semibold tabular">{formatCurrency(operation.own_amount)}</p>
                    </div>
                    <div>
                      <p className="label-caption">De terceiros</p>
                      <p className="font-semibold tabular">{formatCurrency(operation.third_party_amount)}</p>
                    </div>
                  </div>
                ) : null}
                <ul className="divide-y divide-border">
                  {related.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set("lancamento", item.id);
                          router.push(`${pathname}?${params.toString()}`, { scroll: false });
                        }}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[12.5px] hover:bg-surface-muted"
                      >
                        <span className="min-w-0 truncate">{item.description}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone={FIN_ENTRY_STATUS_TONES[item.status]}>{FIN_ENTRY_STATUS_LABELS[item.status]}</Badge>
                          <span className="font-semibold tabular">{formatCurrency(item.amount)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Baixas */}
            {isTitle ? (
              <section>
                <h3 className="mb-2 text-[13px] font-semibold">{entry.kind === "income" ? "Recebimentos" : "Pagamentos"}</h3>
                {settlements.length === 0 ? (
                  <p className="text-[12.5px] text-muted">Nenhuma baixa registrada.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-control border border-border">
                    {settlements.map((settlement) => (
                      <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[12.5px]">
                        <span className={cn(settlement.reversed_at && "text-subtle line-through")}>
                          {formatDate(settlement.settled_on)} · {settlement.account_name}
                          {settlement.payment_method ? ` · ${FIN_PAYMENT_METHOD_LABELS[settlement.payment_method]}` : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          {settlement.reversed_at ? (
                            <span className="text-[11.5px] text-subtle">Estornada: {settlement.reversal_reason}</span>
                          ) : canWrite && !cancelled ? (
                            <Button size="sm" variant="ghost" onClick={() => setReversing(settlement.id)}>
                              <Undo2 />
                              Estornar
                            </Button>
                          ) : null}
                          <span className="font-semibold tabular">{formatCurrency(settlement.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {/* Comprovantes */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">Comprovantes</h3>
                {canWrite && !cancelled ? (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      onChange={handleUpload}
                      aria-label="Escolher comprovante"
                    />
                    <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip />}
                      Anexar
                    </Button>
                  </>
                ) : null}
              </div>
              {attachments.length === 0 ? (
                <p className="text-[12.5px] text-muted">Nenhum comprovante anexado. PDF, JPG, PNG ou WEBP até 10 MB.</p>
              ) : (
                <ul className="divide-y divide-border rounded-control border border-border">
                  {attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center justify-between gap-2 px-3.5 py-2 text-[12.5px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="size-3.5 shrink-0 text-subtle" />
                        <span className="truncate">{attachment.file_name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {attachment.url ? (
                          <Button asChild size="icon" variant="ghost" aria-label={`Abrir ${attachment.file_name}`}>
                            <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                              <Download />
                            </a>
                          </Button>
                        ) : null}
                        {canWrite && !cancelled ? (
                          <Button size="icon" variant="ghost" aria-label={`Remover ${attachment.file_name}`} onClick={() => removeAttachment(attachment)}>
                            <Trash2 />
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Histórico */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                <History className="size-3.5 text-subtle" />
                Histórico de alterações
              </h3>
              {history.length === 0 ? (
                <p className="text-[12.5px] text-muted">Sem registros.</p>
              ) : (
                <ol className="space-y-2 border-l border-border pl-4">
                  {history.map((item) => (
                    <li key={item.id} className="relative text-[12.5px]">
                      <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface bg-border-strong" />
                      <span className="font-medium">
                        {item.entityType === "fin_settlements"
                          ? item.action === "create"
                            ? "Baixa registrada"
                            : "Baixa estornada"
                          : HISTORY_ACTIONS[item.action] ?? item.action}
                      </span>
                      {item.changes.length > 0 ? <span className="text-muted"> · {item.changes.join(", ")}</span> : null}
                      <span className="block text-[11.5px] text-subtle">
                        {formatDateTime(item.createdAt)}
                        {item.userName ? ` · ${item.userName}` : ""}
                        {item.reason ? ` · Motivo: ${item.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </SheetBody>

          {canWrite && !cancelled ? (
            <SheetFooter className="sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {!locked ? (
                  <Button variant="ghost" onClick={() => setCancelling(true)}>
                    <XCircle />
                    Cancelar lançamento
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.origin !== "opening_balance" ? (
                  <Button variant="secondary" onClick={() => setEditing("duplicate")} disabled={locked}>
                    <Copy />
                    Duplicar
                  </Button>
                ) : null}
                {entry.origin !== "opening_balance" ? (
                  <Button variant="secondary" onClick={() => setEditing("edit")}>
                    <Pencil />
                    Editar
                  </Button>
                ) : null}
                {entry.status === "forecast" ? (
                  <Button variant="secondary" onClick={confirmForecast} disabled={confirming}>
                    <CheckCircle2 />
                    Confirmar previsão
                  </Button>
                ) : null}
                {isTitle && isOpen ? (
                  <Button
                    onClick={() =>
                      setSettleTarget({
                        id: entry.id,
                        kind: entry.kind as "income" | "expense",
                        description: entry.description,
                        remaining: entry.remaining_amount,
                        accountId: entry.account_id,
                        paymentMethod: entry.payment_method,
                        isForecast: entry.is_forecast,
                      })
                    }
                  >
                    {entry.kind === "income" ? "Registrar recebimento" : "Registrar pagamento"}
                  </Button>
                ) : null}
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      {editing ? (
        <EntrySheet
          open
          onOpenChange={(open) => !open && setEditing(null)}
          lookups={lookups}
          entryId={editing === "edit" ? entry.id : undefined}
          locked={editing === "edit" && locked}
          title={editing === "duplicate" ? "Duplicar lançamento" : undefined}
          defaultValues={{
            ...entryToFormValues(entry),
            ...(editing === "duplicate"
              ? { settleNow: false, description: entry.description, competenceDate: new Date().toISOString().slice(0, 10) }
              : {}),
          }}
        />
      ) : null}

      <SettleDialog target={settleTarget} accounts={lookups.accounts} onClose={() => setSettleTarget(null)} />

      <ReasonDialog
        open={Boolean(reversing)}
        title="Estornar baixa"
        description="O valor volta para a conta de origem e o lançamento volta a ficar em aberto. A baixa original continua no histórico."
        confirmLabel="Estornar baixa"
        onClose={() => setReversing(null)}
        onConfirm={async (reason) => {
          if (!reversing) return false;
          const result = await reverseFinSettlement(reversing, reason);
          if (result.status === "error") {
            toast.error(result.message);
            return false;
          }
          toast.success("Baixa estornada.");
          router.refresh();
          return true;
        }}
      />

      <ReasonDialog
        open={cancelling}
        title="Cancelar lançamento"
        description="Baixas existentes são estornadas e o lançamento deixa de contar em todos os relatórios. Nada é apagado: tudo fica no histórico."
        confirmLabel="Cancelar lançamento"
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => {
          const result = await cancelFinEntry(entry.id, reason);
          if (result.status === "error") {
            toast.error(result.message);
            return false;
          }
          toast.success("Lançamento cancelado.");
          router.refresh();
          return true;
        }}
      />

      <ReasonDialog
        open={cancellingOperation}
        title="Cancelar operação inteira"
        description="Todos os lançamentos desta operação (entrada no caixa, receita da imobiliária e repasses) são estornados juntos."
        confirmLabel="Cancelar operação"
        onClose={() => setCancellingOperation(false)}
        onConfirm={async (reason) => {
          if (!operation) return false;
          const result = await cancelFinOperation(operation.id, reason);
          if (result.status === "error") {
            toast.error(result.message);
            return false;
          }
          toast.success("Operação cancelada.");
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
