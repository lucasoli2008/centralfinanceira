"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
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
import { archiveWork, unarchiveWork } from "./actions";

export function WorkDetailActions({ workId, isArchived }: { workId: string; isArchived: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function confirmArchive() {
    setPending(true);
    const result = await archiveWork(workId, reason || undefined);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Obra arquivada.");
    setOpen(false);
    router.refresh();
  }

  async function reopen() {
    setPending(true);
    const result = await unarchiveWork(workId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Obra reaberta.");
    router.refresh();
  }

  if (isArchived) {
    return (
      <Button variant="secondary" onClick={reopen} disabled={pending}>
        <ArchiveRestore />
        Reabrir obra
      </Button>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Archive />
        Arquivar
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arquivar obra</DialogTitle>
            <DialogDescription>
              A obra sai das listas ativas, mas seus lançamentos, anexos e histórico continuam
              preservados. É possível reabri-la a qualquer momento.
            </DialogDescription>
          </DialogHeader>

          <FormField label="Motivo" htmlFor="archive-reason" hint="Opcional.">
            <Input
              id="archive-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Obra concluída e encerrada"
            />
          </FormField>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
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
