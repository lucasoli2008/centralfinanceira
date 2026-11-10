"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { payOccurrence } from "./simple-actions";
import type { MonthRecurringItem } from "@/server/queries/finance-month";

function BillRow({
  item,
  accounts,
  canWrite,
}: {
  item: MonthRecurringItem;
  accounts: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const done = item.status === "settled";
  const [amount, setAmount] = React.useState<number | null>(item.remaining || item.amount);
  const [paidOn, setPaidOn] = React.useState(item.due_date);
  const [accountId, setAccountId] = React.useState(item.account_id ?? accounts[0]?.id ?? "");
  const [pending, setPending] = React.useState(false);
  const isIncome = item.kind === "income";

  async function pay() {
    if (!amount) return;
    setPending(true);
    const result = await payOccurrence(item.entry_id, { amount, paidOn, accountId });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(isIncome ? "Recebimento registrado." : "Pagamento registrado.");
    router.refresh();
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-3", done && "bg-positive-soft/40")}>
      <div className="min-w-[180px] flex-1">
        <Link href={`?aba=${isIncome ? "entradas" : "saidas"}&lancamento=${item.entry_id}`} className="font-medium hover:underline">
          {item.description}
        </Link>
        <p className="flex items-center gap-1.5 text-[11.5px] text-subtle">
          <Repeat className="size-3" />
          {item.value_mode === "variable" ? "Todo mês, valor muda" : "Todo mês, mesmo valor"}
          {item.category_name ? ` · ${item.category_name}` : ""} · vence {formatDate(item.due_date)}
        </p>
      </div>

      {done ? (
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-positive">
          <CheckCircle2 className="size-4" />
          {isIncome ? "Recebido" : "Pago"} · {formatCurrency(item.amount)}
        </span>
      ) : canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          {item.value_mode === "variable" ? (
            <div className="w-32">
              <MoneyInput
                id={`bill-amount-${item.entry_id}`}
                aria-label={`Valor real de ${item.description}`}
                value={amount}
                onChange={setAmount}
              />
            </div>
          ) : (
            <span className="w-32 text-right text-[13px] font-semibold tabular">{formatCurrency(item.remaining || item.amount)}</span>
          )}
          <Input
            type="date"
            aria-label="Data do pagamento"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className="h-9 w-36"
          />
          {accounts.length > 1 ? (
            <NativeSelect aria-label="Conta" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-9 w-36">
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <Button size="sm" onClick={pay} disabled={pending || !amount || !accountId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isIncome ? "Recebi" : "Paguei"}
          </Button>
        </div>
      ) : (
        <span className="text-[13px] tabular text-muted">{formatCurrency(item.amount)} · em aberto</span>
      )}
    </li>
  );
}

/** Contas que se repetem todo mês: um clique para pagar; nas variáveis, digite o valor real. */
export function MonthBills({
  items,
  accounts,
  canWrite,
}: {
  items: MonthRecurringItem[];
  accounts: { id: string; name: string }[];
  canWrite: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-muted">
        Nenhuma conta fixa neste mês. Ao lançar algo que se repete, marque “Repete todo mês” e ela aparece aqui nos próximos meses.
      </p>
    );
  }
  const pendingTotal = items.filter((item) => item.status !== "settled").reduce((sum, item) => sum + item.remaining, 0);
  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <BillRow key={item.entry_id} item={item} accounts={accounts} canWrite={canWrite} />
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-right text-[12px] text-muted">
        Falta pagar/receber neste mês: <strong className="tabular text-foreground">{formatCurrency(pendingTotal)}</strong>
      </p>
    </>
  );
}
