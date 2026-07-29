"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, Input } from "@/components/ui/field";
import { deleteEntry } from "./actions";
import type { EntryType } from "@/lib/finance/types";

export function EntryDetailActions({
  entryId,
  entryType,
}: {
  entryId: string;
  entryType: EntryType;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    const result = await deleteEntry(entryId, reason || undefined);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Lançamento movido para a lixeira.");
    setOpen(false);
    router.push(entryType === "sale" ? "/vendas" : "/locacoes");
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Trash2 />
        Excluir
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento</DialogTitle>
            <DialogDescription>
              O lançamento sai dos totais e vai para a lixeira, onde pode ser restaurado. A ação
              fica registrada na auditoria.
            </DialogDescription>
          </DialogHeader>

          <FormField label="Motivo" htmlFor="reason" hint="Opcional.">
            <Input
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Lançamento duplicado"
            />
          </FormField>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirm} disabled={pending}>
              Excluir lançamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
