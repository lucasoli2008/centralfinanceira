"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Eye, MoreHorizontal, Paperclip, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField, Textarea } from "@/components/ui/field";
import { WorksFilters } from "./works-filters";
import { archiveWork } from "./actions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from "@/lib/formatting/labels";
import type { WorkAggregate } from "@/server/queries/works";
import type { WorkRow } from "@/types/database";

interface WorksTableProps {
  rows: WorkRow[];
  aggregates: Record<string, WorkAggregate>;
  years: number[];
  page: number;
  pageSize: number;
  total: number;
}

export function WorksTable({ rows, aggregates, years, page, pageSize, total }: WorksTableProps) {
  const router = useRouter();
  const [archiving, setArchiving] = React.useState<WorkRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function confirmArchive() {
    if (!archiving) return;
    setPending(true);
    const result = await archiveWork(archiving.id, reason || undefined);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Obra arquivada.");
    setArchiving(null);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <WorksFilters years={years} />

      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma obra encontrada."
            description="Crie a primeira obra para começar a organizar serviços, materiais, fotos e documentos."
            actionLabel="Nova obra"
            actionHref="/obras/nova"
            icon="search"
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Obras cadastradas</caption>
              <THead>
                <TR>
                  <TH>Obra</TH>
                  <TH>Imóvel</TH>
                  <TH>Proprietário</TH>
                  <TH>Responsável</TH>
                  <TH>Status</TH>
                  <TH>Início</TH>
                  <TH>Atualizada</TH>
                  <TH numeric>Gasto total</TH>
                  <TH numeric>Anexos</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>

              <TBody>
                {rows.map((row) => {
                  const aggregate = aggregates[row.id] ?? { totalAmount: 0, attachmentsCount: 0 };
                  return (
                    <TR key={row.id}>
                      <TD>
                        <Link href={`/obras/${row.id}`} className="font-medium hover:text-accent hover:underline">
                          {row.title}
                        </Link>
                        <p className="text-[11.5px] text-subtle">{row.code}</p>
                      </TD>
                      <TD className="text-muted">
                        {row.property_label}
                        <p className="text-[11.5px] text-subtle">{row.address}</p>
                      </TD>
                      <TD className="text-muted">{row.owner_label}</TD>
                      <TD className="text-muted">{row.responsible_name}</TD>
                      <TD>
                        <Badge tone={WORK_STATUS_TONES[row.status]}>{WORK_STATUS_LABELS[row.status]}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap tabular">
                        {row.started_at ? formatDate(row.started_at) : "—"}
                      </TD>
                      <TD className="whitespace-nowrap tabular">{formatDate(row.updated_at)}</TD>
                      <TD numeric className="font-medium">
                        {formatCurrency(aggregate.totalAmount)}
                      </TD>
                      <TD numeric>
                        {aggregate.attachmentsCount > 0 ? (
                          <span className="inline-flex items-center gap-1 text-muted">
                            <Paperclip className="size-3.5" />
                            {aggregate.attachmentsCount}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </TD>
                      <TD>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações da obra ${row.title}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem asChild>
                              <Link href={`/obras/${row.id}`}>
                                <Eye />
                                Ver detalhes
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/obras/${row.id}/editar`}>
                                <Pencil />
                                Editar
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem destructive onSelect={() => setArchiving(row)}>
                              <Archive />
                              Arquivar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-[13px]" aria-label="Paginação das obras">
          <p className="text-muted">
            Página {page} de {totalPages} · {total} obras
          </p>
          <div className="flex gap-2">
            <PageLink page={page - 1} disabled={page <= 1} label="Anterior" />
            <PageLink page={page + 1} disabled={page >= totalPages} label="Próxima" />
          </div>
        </nav>
      ) : null}

      <Dialog open={Boolean(archiving)} onOpenChange={(open) => !open && setArchiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar obra</DialogTitle>
            <DialogDescription>
              A obra sai das listas ativas, mas o histórico, os lançamentos e os anexos continuam
              guardados. Pode ser reaberta depois.
            </DialogDescription>
          </DialogHeader>

          <FormField label="Motivo" htmlFor="archive-reason" hint="Opcional.">
            <Textarea
              id="archive-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Obra concluída e já entregue ao proprietário"
            />
          </FormField>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmArchive} disabled={pending}>
              Arquivar obra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
