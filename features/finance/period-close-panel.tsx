"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReasonDialog } from "./reason-dialog";
import { closeFinPeriod, reopenFinPeriod } from "./close-actions";

/** Botões de fechar e reabrir o mês. O banco confere perfil e datas de novo. */
export function PeriodCloseActions({
  year,
  month,
  label,
  isClosed,
  canClose,
  canReopen,
  closable,
  warnings,
}: {
  year: number;
  month: number;
  label: string;
  isClosed: boolean;
  canClose: boolean;
  canReopen: boolean;
  closable: boolean;
  warnings: number;
}) {
  const router = useRouter();
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function close() {
    setPending(true);
    const result = await closeFinPeriod(year, month, notes);
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(`${label} fechado.`);
    setCloseOpen(false);
    router.refresh();
  }

  if (isClosed) {
    return canReopen ? (
      <>
        <Button variant="secondary" onClick={() => setReopenOpen(true)}>
          <LockOpen />
          Reabrir mês
        </Button>
        <ReasonDialog
          open={reopenOpen}
          title={`Reabrir ${label}`}
          description="Lançamentos com data neste mês voltam a poder ser alterados. O motivo fica na auditoria; feche de novo depois de corrigir."
          confirmLabel="Reabrir"
          onClose={() => setReopenOpen(false)}
          onConfirm={async (reason) => {
            const result = await reopenFinPeriod(year, month, reason);
            if (result.status === "error") {
              toast.error(result.message);
              return false;
            }
            toast.success(`${label} reaberto.`);
            router.refresh();
            return true;
          }}
        />
      </>
    ) : null;
  }

  if (!canClose || !closable) return null;

  return (
    <>
      <Button onClick={() => setCloseOpen(true)}>
        <Lock />
        Fechar mês
      </Button>
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fechar {label}</DialogTitle>
            <DialogDescription>
              Depois de fechado, nenhum lançamento, baixa, estorno ou cancelamento com data neste mês é aceito. Guardamos um retrato
              do resultado e dos saldos.
              {warnings > 0 ? ` Ainda há ${warnings} item(ns) a revisar no checklist — você pode fechar mesmo assim.` : ""}
            </DialogDescription>
          </DialogHeader>
          <FormField label="Observações do fechamento" htmlFor="close-notes" hint="Opcional. Ex.: conferido com extratos do Itaú e da poupança.">
            <Textarea id="close-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={close} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock />}
              Confirmar fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
