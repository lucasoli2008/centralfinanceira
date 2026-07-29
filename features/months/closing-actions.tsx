"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
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
import { FormField, Textarea } from "@/components/ui/field";
import { closeMonth, reopenMonth } from "./actions";
import { formatMonthYear } from "@/lib/formatting/date";

interface ClosingActionsProps {
  year: number;
  month: number;
  isClosed: boolean;
  enabled: boolean;
}

export function ClosingActions({ year, month, isClosed, enabled }: ClosingActionsProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  if (!enabled) return null;

  async function handleClose() {
    setPending(true);
    const result = await closeMonth(year, month);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(`${formatMonthYear(year, month)} fechado.`);
    router.refresh();
  }

  async function handleReopen() {
    setPending(true);
    const result = await reopenMonth(year, month, reason);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(`${formatMonthYear(year, month)} reaberto.`);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!isClosed) {
    return (
      <Button variant="secondary" onClick={handleClose} disabled={pending}>
        <Lock />
        Fechar mês
      </Button>
    );
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <LockOpen />
        Reabrir mês
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir {formatMonthYear(year, month)}</DialogTitle>
            <DialogDescription>
              A reabertura libera novos lançamentos, edições e exclusões neste mês. A justificativa
              fica registrada na auditoria.
            </DialogDescription>
          </DialogHeader>

          <FormField
            label="Justificativa"
            htmlFor="reopen-reason"
            required
            hint="Mínimo de 10 caracteres."
          >
            <Textarea
              id="reopen-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleReopen} disabled={pending || reason.trim().length < 10}>
              Reabrir mês
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
