"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Link2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkAttachmentDialog } from "./work-attachment-dialog";
import { deleteWorkAttachment } from "./actions";
import { formatDateTime } from "@/lib/formatting/date";
import { formatCurrency } from "@/lib/formatting/number";
import { WORK_ATTACHMENT_CATEGORY_LABELS } from "@/lib/formatting/labels";
import type { WorkAttachmentWithUrl } from "@/lib/works/types";
import type { WorkAttachmentCategory, WorkEntryRow } from "@/types/database";

const DOCUMENT_CATEGORIES: WorkAttachmentCategory[] = [
  "nota_fiscal",
  "recibo",
  "orcamento",
  "comprovante",
  "outro_documento",
];

export function WorkAttachmentsSection({
  workId,
  documents,
  entries,
  readOnly = false,
}: {
  workId: string;
  documents: WorkAttachmentWithUrl[];
  entries: WorkEntryRow[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const entriesById = React.useMemo(
    () => Object.fromEntries(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<WorkAttachmentWithUrl | null>(null);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const result = await deleteWorkAttachment(deleting.id, workId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Documento removido.");
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Documentos</h3>
        {readOnly ? null : (
          <Button size="sm" variant="secondary" onClick={() => setUploadOpen(true)}>
            <Plus />
            Adicionar documento
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          title="Nenhum documento enviado ainda."
          description="Envie notas fiscais, recibos, orçamentos ou comprovantes desta obra."
          icon="inbox"
        />
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {documents.map((document) => {
            const linked = document.work_entry_id ? entriesById[document.work_entry_id] : undefined;
            return (
              <li key={document.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-4 shrink-0 text-subtle" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{document.file_name}</p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      <Badge tone="neutral">{WORK_ATTACHMENT_CATEGORY_LABELS[document.category]}</Badge>
                      <span>{formatDateTime(document.created_at)}</span>
                      {document.description ? <span>· {document.description}</span> : null}
                    </p>
                    {linked ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-accent">
                        <Link2 className="size-3" />
                        {linked.description} · {formatCurrency(linked.total_amount)}
                        {linked.is_paid ? (
                          <Badge tone="positive" className="ml-1">
                            Pago
                          </Badge>
                        ) : (
                          <Badge tone="warning" className="ml-1">
                            A pagar
                          </Badge>
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {document.url ? (
                    <Button asChild variant="ghost" size="icon" aria-label={`Baixar ${document.file_name}`}>
                      <a href={document.url} target="_blank" rel="noopener noreferrer">
                        <Download />
                      </a>
                    </Button>
                  ) : null}
                  {readOnly ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${document.file_name}`}
                      onClick={() => setDeleting(document)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uploadOpen ? (
        <WorkAttachmentDialog
          open
          onOpenChange={setUploadOpen}
          workId={workId}
          categories={DOCUMENT_CATEGORIES}
          defaultCategory="nota_fiscal"
          entries={entries}
          title="Adicionar documento"
          description="Nota fiscal, recibo, orçamento ou comprovante desta obra."
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover documento</DialogTitle>
            <DialogDescription>O arquivo sai desta obra e do relatório em PDF.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
