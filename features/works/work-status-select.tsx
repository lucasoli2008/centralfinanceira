"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateWorkStatus } from "./actions";
import { WORK_STATUSES } from "@/lib/validation/work";
import { WORK_STATUS_LABELS } from "@/lib/formatting/labels";
import { formatDate } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import type { WorkStatus } from "@/types/database";

const STATUS_CLASSES: Record<WorkStatus, string> = {
  planejada: "border-border bg-surface-muted text-muted",
  em_andamento: "border-accent-border bg-accent-soft text-accent",
  pausada: "border-transparent bg-warning-soft text-warning",
  aguardando_material: "border-transparent bg-warning-soft text-warning",
  aguardando_prestador: "border-transparent bg-warning-soft text-warning",
  concluida: "border-transparent bg-positive-soft text-positive",
  cancelada: "border-transparent bg-danger-soft text-danger",
};

export function WorkStatusSelect({
  workId,
  status,
  completedAt,
  disabled = false,
}: {
  workId: string;
  status: WorkStatus;
  completedAt: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState<WorkStatus | null>(null);

  async function apply(next: WorkStatus) {
    setPending(true);
    const result = await updateWorkStatus(workId, next);
    setPending(false);
    setConfirming(null);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success(`Status alterado para ${WORK_STATUS_LABELS[next].toLowerCase()}.`);
    router.refresh();
  }

  function onChange(next: WorkStatus) {
    if (next === status) return;
    if (next === "concluida" || next === "cancelada") {
      setConfirming(next);
      return;
    }
    void apply(next);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <NativeSelect
        aria-label="Status da obra"
        value={status}
        disabled={disabled || pending}
        onChange={(event) => onChange(event.target.value as WorkStatus)}
        className={cn("h-8 w-auto rounded-full border pr-8 text-[12px] font-semibold uppercase tracking-[0.03em]", STATUS_CLASSES[status])}
      >
        {WORK_STATUSES.map((value) => (
          <option key={value} value={value}>
            {WORK_STATUS_LABELS[value]}
          </option>
        ))}
      </NativeSelect>

      <Dialog open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "concluida" ? "Concluir obra" : "Cancelar obra"}
            </DialogTitle>
            <DialogDescription>
              {confirming === "concluida"
                ? `A obra será marcada como concluída${completedAt ? ` (conclusão registrada em ${formatDate(completedAt)})` : ` com data de conclusão ${formatDate(today)}`}. Você pode ajustar a data depois em Editar.`
                : "A obra passa para cancelada. Os lançamentos e anexos continuam guardados e o status pode ser revertido."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>
              Voltar
            </Button>
            <Button
              variant={confirming === "cancelada" ? "danger" : "primary"}
              disabled={pending}
              onClick={() => confirming && apply(confirming)}
            >
              {confirming === "concluida" ? "Marcar como concluída" : "Cancelar obra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
