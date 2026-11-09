"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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

/** Confirmação com motivo obrigatório (estornos e cancelamentos são auditados). */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    const ok = await onConfirm(reason.trim());
    setPending(false);
    if (ok) {
      setReason("");
      onClose();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormField
          label="Motivo"
          htmlFor="reason-input"
          required
          hint="Mínimo de 10 caracteres. Fica registrado no histórico e na auditoria."
        >
          <Textarea id="reason-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={confirm} disabled={pending || reason.trim().length < 10}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
