"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReasonDialog } from "@/features/finance/reason-dialog";
import { markCommissionReceived, unmarkCommissionReceived } from "@/features/finance/simple-actions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";

export interface ReceiptInfo {
  operationId: string;
  receivedOn: string;
}

const LAST_ACCOUNT_KEY = "central-financeira:conta-recebimento";

function readLastAccount() {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/**
 * Bolinha "Recebido" de uma comissão. Marcar pede a data em que o dinheiro
 * entrou (digitada, sem valor padrão, para não lançar na data errada) e lança a
 * comissão no Controle Financeiro. Desmarcar estorna tudo, com motivo.
 */
export function CommissionReceiptToggle({
  entryId,
  description,
  grossCommission,
  netRevenue,
  brokerPayout,
  receipt,
  accounts,
  canReceive,
  blocked,
}: {
  entryId: string;
  description: string;
  grossCommission: number;
  netRevenue: number;
  brokerPayout: number;
  receipt: ReceiptInfo | null;
  accounts: { id: string; name: string }[];
  canReceive: boolean;
  /** Exceção financeira: repasses maiores que a comissão — lançar manualmente. */
  blocked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [undoOpen, setUndoOpen] = React.useState(false);
  const [date, setDate] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [pending, setPending] = React.useState(false);

  function start() {
    const last = readLastAccount();
    setAccountId(accounts.find((account) => account.id === last)?.id ?? accounts[0]?.id ?? "");
    setDate("");
    setOpen(true);
  }

  async function confirm() {
    setPending(true);
    const result = await markCommissionReceived(entryId, { receivedOn: date, accountId });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    try {
      window.localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
    } catch {
      // preferência opcional
    }
    toast.success("Recebido! A comissão entrou no Controle Financeiro.");
    setOpen(false);
    router.refresh();
  }

  if (receipt) {
    return (
      <>
        <button
          type="button"
          onClick={() => canReceive && setUndoOpen(true)}
          disabled={!canReceive}
          title={canReceive ? "Recebido — clique para desfazer" : "Recebido"}
          className="inline-flex items-center gap-1.5 rounded-full bg-positive px-2 py-0.5 text-[11.5px] font-semibold text-white disabled:cursor-default"
        >
          <Check className="size-3.5" strokeWidth={3} />
          {formatDate(receipt.receivedOn)}
        </button>
        <ReasonDialog
          open={undoOpen}
          title="Desfazer recebimento"
          description={`A entrada de ${formatCurrency(grossCommission)} sai do caixa e os repasses aos corretores são cancelados no Controle Financeiro. O motivo fica registrado.`}
          confirmLabel="Desfazer recebimento"
          onClose={() => setUndoOpen(false)}
          onConfirm={async (reason) => {
            const result = await unmarkCommissionReceived(receipt.operationId, reason);
            if (result.status === "error") {
              toast.error(result.message);
              return false;
            }
            toast.success("Recebimento desfeito.");
            router.refresh();
            return true;
          }}
        />
      </>
    );
  }

  if (blocked) {
    return (
      <span className="text-[11px] text-subtle" title="Repasses maiores que a comissão: lance o recebimento manualmente no Controle Financeiro.">
        Manual
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={!canReceive || accounts.length === 0 || grossCommission <= 0}
        aria-label={`Marcar ${description} como recebida`}
        title={accounts.length === 0 ? "Cadastre uma conta no Controle Financeiro" : "Marcar como recebido"}
        className="group inline-flex items-center gap-1.5 rounded-full px-1 text-[11.5px] text-subtle transition-colors hover:text-positive disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Circle className="size-5 transition-transform group-hover:scale-110" />
        <span className="hidden xl:inline">A receber</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Comissão recebida</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 rounded-card border border-border bg-surface-sunken p-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted">Entra no caixa</span>
              <strong className="tabular">{formatCurrency(grossCommission)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Fica para a imobiliária</span>
              <strong className="tabular text-positive">{formatCurrency(netRevenue)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">A repassar aos corretores</span>
              <strong className="tabular">{formatCurrency(brokerPayout)}</strong>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Data em que o dinheiro entrou" htmlFor={`receipt-date-${entryId}`} required hint="Digite a data do extrato.">
              <Input id={`receipt-date-${entryId}`} type="date" value={date} onChange={(event) => setDate(event.target.value)} autoFocus />
            </FormField>
            <FormField label="Conta" htmlFor={`receipt-account-${entryId}`} required>
              <NativeSelect id={`receipt-account-${entryId}`} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={pending || !date || !accountId} className={cn(!pending && "bg-positive hover:bg-positive/90")}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check />}
              Confirmar recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
