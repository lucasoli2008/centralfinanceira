"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Plus, Repeat, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/finance/money-input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CategoryOptions } from "./entry-sheet";
import { suggestFinCategory } from "./actions";
import { saveQuickEntry } from "./simple-actions";
import type { FinLookups } from "@/server/queries/finance";

type Repeat = "none" | "fixed" | "variable";

const REPEAT_OPTIONS: { value: Repeat; title: string; hint: string }[] = [
  { value: "none", title: "Não repete", hint: "Gasto ou recebimento único." },
  { value: "fixed", title: "Todo mês, mesmo valor", hint: "Ex.: salário, aluguel, contador." },
  { value: "variable", title: "Todo mês, valor muda", hint: "Ex.: luz, água, telefone. Usamos o último valor como estimativa." },
];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Botão + gaveta de lançamento rápido, com data padrão dentro do mês aberto. */
export function QuickEntryButton({
  lookups,
  defaultDate,
  defaultKind = "expense",
  label = "Novo lançamento",
}: {
  lookups: FinLookups;
  defaultDate?: string;
  defaultKind?: "income" | "expense";
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      {open ? (
        <QuickEntrySheet lookups={lookups} defaultDate={defaultDate} defaultKind={defaultKind} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function QuickEntrySheet({
  lookups,
  defaultDate,
  defaultKind,
  onClose,
}: {
  lookups: FinLookups;
  defaultDate?: string;
  defaultKind: "income" | "expense";
  onClose: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState<"income" | "expense">(defaultKind);
  const [date, setDate] = React.useState(defaultDate ?? today());
  const [description, setDescription] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [amount, setAmount] = React.useState<number | null>(null);
  const [paid, setPaid] = React.useState(true);
  const [paidOn, setPaidOn] = React.useState(defaultDate ?? today());
  const [accountId, setAccountId] = React.useState(lookups.accounts[0]?.id ?? "");
  const [recurring, setRecurring] = React.useState<Repeat>("none");
  const [more, setMore] = React.useState(false);
  const [counterpartyId, setCounterpartyId] = React.useState("");
  const [costCenterId, setCostCenterId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [suggestion, setSuggestion] = React.useState<{ categoryId: string; categoryName: string; reason: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  // Sugestão de categoria pelas regras e pelo histórico (nunca aplicada sozinha).
  React.useEffect(() => {
    if (categoryId || description.trim().length < 3) return;
    const handle = window.setTimeout(async () => {
      const found = await suggestFinCategory(kind, description, counterpartyId || null);
      setSuggestion(found);
    }, 450);
    return () => window.clearTimeout(handle);
  }, [description, kind, categoryId, counterpartyId]);

  async function submit() {
    if (amount === null) return;
    setPending(true);
    const result = await saveQuickEntry({
      kind,
      description,
      amount,
      categoryId,
      date,
      paid,
      paidOn: paid ? paidOn : "",
      accountId,
      counterpartyId,
      costCenterId,
      propertyId: "",
      recurring,
      notes: notes || null,
    });
    setPending(false);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    toast.success(
      recurring === "none"
        ? "Lançamento salvo."
        : recurring === "fixed"
          ? "Salvo. Os próximos meses já aparecem com o mesmo valor."
          : "Salvo. Os próximos meses aparecem com este valor como estimativa — você ajusta ao pagar.",
    );
    onClose();
    router.refresh();
  }

  const isIncome = kind === "income";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Novo lançamento</SheetTitle>
          <SheetDescription>O essencial em poucos campos. O resto é opcional.</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <Segmented
            ariaLabel="Tipo"
            options={[
              { value: "expense", label: "Saída (gasto)" },
              { value: "income", label: "Entrada (recebimento)" },
            ]}
            value={kind}
            onChange={(value) => {
              setKind(value);
              setCategoryId("");
            }}
          />

          <FormField label="Descrição" htmlFor="quick-description" required>
            <Input
              id="quick-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={isIncome ? "Ex.: Comissão venda Ed. Aurora" : "Ex.: Salário recepcionista, conta de luz"}
              autoFocus
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Valor" htmlFor="quick-amount" required>
              <MoneyInput id="quick-amount" value={amount} onChange={setAmount} />
            </FormField>
            <FormField label={isIncome ? "Data (referência)" : "Data / vencimento"} htmlFor="quick-date" required>
              <Input id="quick-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
          </div>

          <FormField label="Categoria" htmlFor="quick-category" required>
            <NativeSelect id="quick-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <CategoryOptions categories={lookups.categories} kind={kind} />
            </NativeSelect>
          </FormField>
          {suggestion && !categoryId && description.trim().length >= 3 ? (
            <button
              type="button"
              onClick={() => setCategoryId(suggestion.categoryId)}
              className="-mt-2 flex w-full items-center gap-2 rounded-control border border-info/30 bg-info-soft px-3 py-2 text-left text-[12.5px] text-info"
            >
              <Sparkles className="size-3.5 shrink-0" />
              <span>
                Usar <strong>{suggestion.categoryName}</strong>? <span className="text-muted">{suggestion.reason}</span>
              </span>
            </button>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="mb-1 flex items-center gap-1.5 text-[13px] font-medium">
              <Repeat className="size-3.5 text-subtle" />
              Repete todo mês?
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {REPEAT_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-card border px-3 py-2 text-[12.5px] transition-colors",
                    recurring === option.value ? "border-accent-border bg-accent-soft" : "border-border hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="quick-recurring"
                    value={option.value}
                    checked={recurring === option.value}
                    onChange={() => setRecurring(option.value)}
                    className="sr-only"
                  />
                  <span className="block font-semibold">{option.title}</span>
                  <span className="text-muted">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-card border border-border p-3">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <Checkbox checked={paid} onChange={(event) => setPaid(event.target.checked)} />
              {isIncome ? "Já recebi" : "Já paguei"}
            </label>
            {paid ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FormField label={isIncome ? "Recebido em" : "Pago em"} htmlFor="quick-paid-on">
                  <Input id="quick-paid-on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
                </FormField>
                <FormField label="Conta" htmlFor="quick-account">
                  <NativeSelect id="quick-account" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    <option value="">Selecione…</option>
                    {lookups.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-muted">Fica em “{isIncome ? "a receber" : "a pagar"}” até você registrar o pagamento.</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMore((value) => !value)}
            className="flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
            Mais detalhes (favorecido, centro de custo, observações)
          </button>
          {more ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={isIncome ? "Quem pagou" : "Para quem"} htmlFor="quick-payee">
                <NativeSelect id="quick-payee" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
                  <option value="">Não informar</option>
                  {lookups.counterparties.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Centro de custo" htmlFor="quick-cost-center">
                <NativeSelect id="quick-cost-center" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
                  <option value="">Nenhum</option>
                  {lookups.costCenters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Observações" htmlFor="quick-notes" className="sm:col-span-2">
                <Textarea id="quick-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </FormField>
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !description.trim() || !amount || !categoryId || (paid && !accountId)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
