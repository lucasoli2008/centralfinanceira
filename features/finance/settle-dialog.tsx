"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FIN_PAYMENT_METHODS } from "@/lib/validation/finance";
import { FIN_PAYMENT_METHOD_LABELS } from "@/lib/formatting/labels";
import { formatCurrency } from "@/lib/formatting/number";
import { settleFinEntry } from "./actions";
import type { FinAccountRow, FinPaymentMethod } from "@/types/database";

export interface SettleTarget {
  id: string;
  kind: "income" | "expense";
  description: string;
  remaining: number;
  accountId: string | null;
  paymentMethod: FinPaymentMethod | null;
  isForecast: boolean;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Baixa total ou parcial. Pagar não é o mesmo que lançar: só aqui o saldo da
 * conta muda e o título passa a liquidado.
 */
export function SettleDialog({
  target,
  accounts,
  onClose,
}: {
  target: SettleTarget | null;
  accounts: FinAccountRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [accountId, setAccountId] = React.useState("");
  const [settledOn, setSettledOn] = React.useState(today());
  const [amount, setAmount] = React.useState<number | null>(null);
  const [method, setMethod] = React.useState<string>("");
  const [notes, setNotes] = React.useState("");
  const [lastTarget, setLastTarget] = React.useState<string | null>(null);

  // Reinicia o formulário quando outro título é aberto (ajuste durante a renderização).
  if (target && target.id !== lastTarget) {
    setLastTarget(target.id);
    setAccountId(target.accountId ?? accounts[0]?.id ?? "");
    setSettledOn(today());
    setAmount(target.remaining);
    setMethod(target.paymentMethod ?? "");
    setNotes("");
  }

  const isIncome = target?.kind === "income";
  const partial = target && amount !== null && amount > 0 && amount < target.remaining;

  async function confirm() {
    if (!target) return;
    setPending(true);
    const result = await settleFinEntry(target.id, {
      accountId,
      settledOn,
      amount: amount ?? 0,
      paymentMethod: (method || "") as FinPaymentMethod | "",
      notes: notes || null,
    });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(isIncome ? "Recebimento registrado." : "Pagamento registrado.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isIncome ? "Registrar recebimento" : "Registrar pagamento"}</DialogTitle>
          <DialogDescription>
            {target?.description} · em aberto {formatCurrency(target?.remaining ?? 0)}
            {target?.isForecast ? " · confirmar esta baixa transforma a previsão em lançamento real." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Valor" htmlFor="settle-amount" required hint={partial ? "Baixa parcial — o restante continua em aberto." : undefined}>
            <MoneyInput id="settle-amount" value={amount} onChange={setAmount} />
          </FormField>
          <FormField label={isIncome ? "Recebido em" : "Pago em"} htmlFor="settle-date" required>
            <Input id="settle-date" type="date" value={settledOn} onChange={(event) => setSettledOn(event.target.value)} />
          </FormField>
          <FormField label="Conta" htmlFor="settle-account" required>
            <NativeSelect id="settle-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Selecione…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Forma de pagamento" htmlFor="settle-method">
            <NativeSelect id="settle-method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="">Não informada</option>
              {FIN_PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {FIN_PAYMENT_METHOD_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Observação" htmlFor="settle-notes" className="sm:col-span-2">
            <Textarea id="settle-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={pending || !accountId || !amount}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isIncome ? "Confirmar recebimento" : "Confirmar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
