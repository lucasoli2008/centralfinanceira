"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, CheckCircle2, Loader2, MoreHorizontal, Repeat, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { deleteMonthEntry, payOccurrence, stopRecurrence } from "./simple-actions";
import type { MonthExpense, MonthIncome } from "@/server/queries/finance-month";

function StatusChip({ status }: { status: MonthExpense["status"] }) {
  if (status === "settled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-semibold text-positive">
        <CheckCircle2 className="size-3" /> Pago
      </span>
    );
  }
  if (status === "forecast") {
    return <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">Previsto</span>;
  }
  return <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">A pagar</span>;
}

function ExpenseRow({ item, canWrite, locked }: { item: MonthExpense; canWrite: boolean; locked: boolean }) {
  const router = useRouter();
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState<number | null>(item.remaining || item.amount);
  const [paidOn, setPaidOn] = React.useState(item.date);
  const [busy, setBusy] = React.useState(false);
  const pending = item.status !== "settled";

  async function run(action: () => Promise<{ status: string; message?: string }>, success: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.status === "error") {
      toast.error(result.message ?? "Não foi possível concluir.");
      return;
    }
    toast.success(success);
    setPaying(false);
    router.refresh();
  }

  return (
    <li className={cn("px-4 py-2.5", item.status === "forecast" && "bg-surface-sunken/50")}>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-[12px] tabular text-subtle">{formatDate(item.date).slice(0, 5)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{item.description}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-subtle">
            <span>{item.categoryName}</span>
            {item.counterpartyName ? <span>· {item.counterpartyName}</span> : null}
            {item.recurrenceId ? (
              <span className="inline-flex items-center gap-1">
                · <Repeat className="size-3" /> {item.valueMode === "variable" ? "todo mês, valor muda" : "todo mês"}
              </span>
            ) : null}
          </p>
        </div>
        <StatusChip status={item.status} />
        <span className="w-28 shrink-0 text-right text-[14px] font-semibold tabular">{formatCurrency(item.amount)}</span>
        {canWrite && !locked ? (
          <div className="flex w-[118px] shrink-0 justify-end gap-1">
            {pending ? (
              <Button size="sm" variant={paying ? "ghost" : "secondary"} onClick={() => setPaying((value) => !value)}>
                {paying ? "Fechar" : "Paguei"}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`Opções de ${item.description}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/financeiro/lancamentos?lancamento=${item.id}`}>Ver detalhes / editar</Link>
                </DropdownMenuItem>
                {item.recurrenceId ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      if (window.confirm("Parar de repetir? Os próximos meses ainda não pagos deixam de aparecer. O que já foi pago continua.")) {
                        run(() => stopRecurrence(item.recurrenceId!), "Não vai mais repetir.");
                      }
                    }}
                  >
                    <XCircle />
                    Parar de repetir
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    if (window.confirm(`Excluir "${item.description}" deste mês?`)) run(() => deleteMonthEntry(item.id), "Saída excluída.");
                  }}
                >
                  <Trash2 />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {paying ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface px-3 py-2 sm:ml-[60px]">
          <label className="text-[12px] text-muted">
            Valor pago
            <div className="w-36">
              <MoneyInput id={`pay-${item.id}`} value={amount} onChange={setAmount} />
            </div>
          </label>
          <label className="text-[12px] text-muted">
            Pago em
            <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} className="h-9 w-40" />
          </label>
          <Button
            size="sm"
            disabled={busy || !amount}
            onClick={() => run(() => payOccurrence(item.id, { amount: amount ?? 0, paidOn }), "Pagamento registrado.")}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 />}
            Confirmar pagamento
          </Button>
          {item.valueMode === "variable" ? (
            <p className="w-full text-[11.5px] text-subtle">Digite o valor que veio na conta deste mês. Os próximos meses passam a usar este valor como estimativa.</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Saídas do mês agrupadas por categoria, com subtotal de cada grupo. */
export function MonthExpenses({ expenses, canWrite, locked }: { expenses: MonthExpense[]; canWrite: boolean; locked: boolean }) {
  if (expenses.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-muted">
        Nenhuma saída neste mês ainda. Clique em <strong>Nova saída</strong> para cadastrar salários, contas, aluguel…
      </p>
    );
  }
  const groups = new Map<string, MonthExpense[]>();
  for (const item of expenses) groups.set(item.groupName, [...(groups.get(item.groupName) ?? []), item]);
  const ordered = [...groups.entries()].sort(
    (a, b) => b[1].reduce((sum, item) => sum + item.amount, 0) - a[1].reduce((sum, item) => sum + item.amount, 0),
  );

  return (
    <div className="divide-y divide-border">
      {ordered.map(([group, items]) => (
        <section key={group}>
          <header className="flex items-center justify-between bg-surface-muted/60 px-4 py-1.5">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted">{group}</h3>
            <span className="text-[12px] font-semibold tabular text-muted">{formatCurrency(items.reduce((sum, item) => sum + item.amount, 0))}</span>
          </header>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <ExpenseRow key={item.id} item={item} canWrite={canWrite} locked={locked} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Entradas do mês: comissões marcadas como "Recebido" em Vendas/Locações e outras entradas. */
export function MonthIncomes({ incomes }: { incomes: MonthIncome[] }) {
  if (incomes.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-muted">
        Nenhuma entrada neste mês. As comissões entram aqui sozinhas quando você marca <strong>Recebido</strong> em{" "}
        <Link href="/vendas" className="text-accent hover:underline">
          Vendas
        </Link>{" "}
        ou{" "}
        <Link href="/locacoes" className="text-accent hover:underline">
          Locações
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {incomes.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-12 shrink-0 text-[12px] tabular text-subtle">{formatDate(item.date).slice(0, 5)}</span>
          <ArrowDownLeft className="size-4 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium">{item.description}</p>
            <p className="text-[11.5px] text-subtle">
              {item.source === "commission"
                ? `Comissão recebida ${formatCurrency(item.gross)}${item.thirdParty ? ` · corretores ${formatCurrency(item.thirdParty)}` : ""}`
                : item.source === "rental"
                  ? `Aluguel recebido ${formatCurrency(item.gross)} · repasse ao proprietário ${formatCurrency(item.thirdParty)}`
                  : "Entrada lançada manualmente"}
            </p>
          </div>
          <span className="w-28 shrink-0 text-right text-[14px] font-semibold tabular text-info">{formatCurrency(item.own)}</span>
        </li>
      ))}
    </ul>
  );
}
