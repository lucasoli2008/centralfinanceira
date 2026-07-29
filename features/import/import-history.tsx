"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { undoImport } from "./actions";
import { formatDateTime } from "@/lib/formatting/date";
import { formatInteger } from "@/lib/formatting/number";
import type { EntryImportRow } from "@/types/database";

export function ImportHistory({ imports }: { imports: EntryImportRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  if (imports.length === 0) {
    return (
      <EmptyState
        title="Nenhuma importação realizada."
        description="O histórico das importações aparece aqui, com a opção de desfazer."
      />
    );
  }

  async function onUndo(importId: string) {
    setPendingId(importId);
    const result = await undoImport(importId);
    setPendingId(null);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(`${result.data.undone} lançamentos removidos da base.`);
    router.refresh();
  }

  return (
    <TableWrapper>
      <Table>
        <caption className="sr-only">Histórico de importações</caption>
        <THead>
          <TR>
            <TH>Arquivo</TH>
            <TH>Importado em</TH>
            <TH numeric>Lançamentos</TH>
            <TH>Situação</TH>
            <TH className="w-10">
              <span className="sr-only">Ações</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {imports.map((item) => (
            <TR key={item.id}>
              <TD className="font-medium">{item.source_filename ?? "Planilha"}</TD>
              <TD className="whitespace-nowrap text-muted">{formatDateTime(item.created_at)}</TD>
              <TD numeric>{formatInteger(item.entries_count)}</TD>
              <TD>
                {item.undone_at ? (
                  <Badge tone="neutral">Desfeita</Badge>
                ) : (
                  <Badge tone="positive">Ativa</Badge>
                )}
              </TD>
              <TD>
                {item.undone_at ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pendingId === item.id}
                    onClick={() => onUndo(item.id)}
                  >
                    <Undo2 />
                    Desfazer
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrapper>
  );
}
