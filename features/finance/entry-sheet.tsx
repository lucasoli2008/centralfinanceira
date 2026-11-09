"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { MoneyInput } from "@/components/finance/money-input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { finEntrySchema, FIN_PAYMENT_METHODS, type FinEntryFormValues } from "@/lib/validation/finance";
import {
  FIN_ENTRY_KIND_LABELS,
  FIN_NATURE_HINTS,
  FIN_PAYMENT_METHOD_LABELS,
} from "@/lib/formatting/labels";
import { formatCurrency } from "@/lib/formatting/number";
import { saveFinEntry, suggestFinCategory, type CategorySuggestion } from "./actions";
import type { FinCategoryRow, FinEntryKind, FinNature } from "@/types/database";
import type { FinLookups } from "@/server/queries/finance";

const KIND_OPTIONS: { value: FinEntryKind; label: string }[] = [
  { value: "expense", label: "Saída" },
  { value: "income", label: "Entrada" },
  { value: "transfer", label: "Transferência" },
  { value: "adjustment", label: "Ajuste" },
];

const INCOME_NATURES: FinNature[] = ["own_revenue", "other_revenue", "third_party", "deposit", "equity"];
const EXPENSE_NATURES: FinNature[] = [
  "deduction",
  "direct_cost",
  "operating_expense",
  "other_expense",
  "third_party",
  "deposit",
  "equity",
];

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function emptyValues(kind: FinEntryKind, accountId: string | null): FinEntryFormValues {
  return {
    kind,
    description: "",
    amount: undefined as unknown as number,
    categoryId: "",
    accountId: accountId ?? "",
    transferAccountId: "",
    adjustmentDirection: null,
    counterpartyId: "",
    costCenterId: "",
    propertyId: "",
    paymentMethod: "",
    competenceDate: today(),
    dueDate: "",
    isForecast: false,
    settleNow: true,
    settledOn: today(),
    installments: 1,
    documentNumber: "",
    notes: "",
  };
}

/** Opções de categoria agrupadas e filtradas pela direção do lançamento. */
function CategoryOptions({ categories, kind }: { categories: FinCategoryRow[]; kind: "income" | "expense" }) {
  const natures = kind === "income" ? INCOME_NATURES : EXPENSE_NATURES;
  const groups = categories.filter((category) => !category.parent_id && natures.includes(category.nature));
  return (
    <>
      <option value="">Selecione…</option>
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {categories
            .filter((category) => category.parent_id === group.id)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export interface EntrySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: FinLookups;
  /** Edição: id e valores atuais. Duplicação: apenas valores. */
  entryId?: string;
  defaultValues?: Partial<FinEntryFormValues>;
  title?: string;
  /** Lançamento gerado por operação/saldo inicial: só campos descritivos. */
  locked?: boolean;
  initialKind?: FinEntryKind;
}

export function EntrySheet({
  open,
  onOpenChange,
  lookups,
  entryId,
  defaultValues,
  title,
  locked = false,
  initialKind = "expense",
}: EntrySheetProps) {
  const router = useRouter();
  const isEditing = Boolean(entryId);
  const [pending, setPending] = React.useState(false);
  const [suggestion, setSuggestion] = React.useState<CategorySuggestion | null>(null);

  const firstAccount = lookups.accounts[0]?.id ?? null;
  const form = useForm<FinEntryFormValues>({
    resolver: zodResolver(finEntrySchema),
    mode: "onBlur",
    defaultValues: { ...emptyValues(initialKind, firstAccount), ...(isEditing ? { settleNow: false } : {}), ...defaultValues },
  });
  const { control, register, handleSubmit, setValue, formState } = form;
  const errors = formState.errors;
  const values = useWatch({ control, defaultValue: form.getValues() }) as FinEntryFormValues;

  const kind = values.kind;
  const isMovement = kind === "transfer" || kind === "adjustment";
  const selectedCategory = lookups.categories.find((category) => category.id === values.categoryId);

  // Ao trocar entre entrada/saída, a categoria anterior deixa de ser válida.
  function changeKind(next: FinEntryKind) {
    setValue("kind", next, { shouldDirty: true });
    setValue("categoryId", "");
    setSuggestion(null);
    if (next === "transfer" || next === "adjustment") {
      setValue("settleNow", false);
      setValue("isForecast", false);
      setValue("installments", 1);
    }
  }

  const requestSuggestion = React.useCallback(async () => {
    const current = form.getValues();
    if (current.kind !== "income" && current.kind !== "expense") return;
    if (current.categoryId) return;
    const result = await suggestFinCategory(current.kind, current.description ?? "", current.counterpartyId || null);
    setSuggestion(result);
  }, [form]);

  async function onSubmit(formValues: FinEntryFormValues) {
    setPending(true);
    const result = await saveFinEntry(formValues, entryId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      if (result.fieldErrors) {
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as keyof FinEntryFormValues, { message });
        }
      }
      return;
    }

    const count = result.data.entryIds.length;
    toast.success(
      isEditing ? "Lançamento atualizado." : count > 1 ? `${count} parcelas registradas.` : "Lançamento registrado.",
    );
    onOpenChange(false);
    router.refresh();
  }

  const installmentValue =
    values.amount && values.installments && values.installments > 1
      ? Math.trunc((Number(values.amount) / values.installments) * 100) / 100
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="entry-sheet-description">
        <form onSubmit={handleSubmit(onSubmit, () => toast.error("Revise os campos destacados."))} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{title ?? (isEditing ? "Editar lançamento" : "Novo lançamento")}</SheetTitle>
            <SheetDescription id="entry-sheet-description">
              {locked
                ? "Este lançamento foi gerado automaticamente. Só os campos descritivos podem ser alterados."
                : "Valores, datas e categoria definem como o lançamento afeta caixa, resultado e obrigações."}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="space-y-5">
            {!isEditing ? (
              <Segmented ariaLabel="Tipo de lançamento" options={KIND_OPTIONS} value={kind} onChange={changeKind} className="w-full" />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <FormField label="Descrição" htmlFor="fin-description" required error={errors.description?.message}>
                <Input id="fin-description" {...register("description", { onBlur: requestSuggestion })} autoFocus={!isEditing} />
              </FormField>
              <FormField label="Valor" htmlFor="fin-amount" required error={errors.amount?.message}>
                <Controller
                  control={control}
                  name="amount"
                  render={({ field }) => (
                    <MoneyInput
                      id="fin-amount"
                      value={field.value as number | null}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      disabled={locked}
                      aria-invalid={Boolean(errors.amount)}
                    />
                  )}
                />
              </FormField>
            </div>

            {/* Classificação ------------------------------------------------ */}
            {!isMovement ? (
              <div className="space-y-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Favorecido / pagador" htmlFor="fin-counterparty" error={errors.counterpartyId?.message}>
                    <NativeSelect
                      id="fin-counterparty"
                      {...register("counterpartyId", { onChange: requestSuggestion })}
                    >
                      <option value="">Não informado</option>
                      {lookups.counterparties.map((counterparty) => (
                        <option key={counterparty.id} value={counterparty.id}>
                          {counterparty.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField label="Categoria" htmlFor="fin-category" required error={errors.categoryId?.message}>
                    <NativeSelect id="fin-category" disabled={locked} {...register("categoryId")}>
                      <CategoryOptions categories={lookups.categories} kind={kind as "income" | "expense"} />
                    </NativeSelect>
                  </FormField>
                </div>

                {suggestion && !values.categoryId ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-info/20 bg-info-soft px-3 py-2 text-[12.5px] text-info">
                    <span className="flex items-start gap-1.5">
                      <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Sugestão: <strong>{suggestion.categoryName}</strong>. {suggestion.reason}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setValue("categoryId", suggestion.categoryId, { shouldDirty: true, shouldValidate: true });
                          setSuggestion(null);
                        }}
                      >
                        Aplicar
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                        Ignorar
                      </Button>
                    </span>
                  </div>
                ) : null}

                {selectedCategory ? (
                  <p className="flex items-start gap-1.5 text-[11.5px] text-subtle">
                    <Info className="mt-0.5 size-3 shrink-0" />
                    {FIN_NATURE_HINTS[selectedCategory.nature]}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Contas ------------------------------------------------------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={kind === "transfer" ? "Conta de origem" : kind === "adjustment" ? "Conta" : "Conta financeira"}
                htmlFor="fin-account"
                required={isMovement || values.settleNow}
                error={errors.accountId?.message}
                hint={!isMovement ? "Onde o dinheiro entra ou sai." : undefined}
              >
                <NativeSelect id="fin-account" disabled={locked} {...register("accountId")}>
                  <option value="">{isMovement ? "Selecione…" : "Definir na baixa"}</option>
                  {lookups.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>

              {kind === "transfer" ? (
                <FormField label="Conta de destino" htmlFor="fin-transfer" required error={errors.transferAccountId?.message}>
                  <NativeSelect id="fin-transfer" disabled={locked} {...register("transferAccountId")}>
                    <option value="">Selecione…</option>
                    {lookups.accounts
                      .filter((account) => account.id !== values.accountId)
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                  </NativeSelect>
                </FormField>
              ) : null}

              {kind === "adjustment" ? (
                <FormField label="Efeito no saldo" htmlFor="fin-direction" required error={errors.adjustmentDirection?.message}>
                  <Controller
                    control={control}
                    name="adjustmentDirection"
                    render={({ field }) => (
                      <Segmented
                        ariaLabel="Efeito do ajuste"
                        options={[
                          { value: "increase", label: "Aumenta" },
                          { value: "decrease", label: "Diminui" },
                        ]}
                        value={(field.value ?? "increase") as "increase" | "decrease"}
                        onChange={field.onChange}
                        className="w-full"
                      />
                    )}
                  />
                </FormField>
              ) : null}

              {!isMovement ? (
                <FormField label="Forma de pagamento" htmlFor="fin-method">
                  <NativeSelect id="fin-method" {...register("paymentMethod")}>
                    <option value="">Não informada</option>
                    {FIN_PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {FIN_PAYMENT_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
            </div>

            {/* Datas e situação --------------------------------------------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={isMovement ? "Data" : "Competência"}
                htmlFor="fin-competence"
                required
                error={errors.competenceDate?.message}
                hint={isMovement ? undefined : "Mês a que a receita/despesa pertence."}
              >
                <Input id="fin-competence" type="date" disabled={locked} {...register("competenceDate")} />
              </FormField>
              {!isMovement ? (
                <FormField label="Vencimento" htmlFor="fin-due" error={errors.dueDate?.message} hint="Deixe em branco se for à vista.">
                  <Input id="fin-due" type="date" {...register("dueDate")} />
                </FormField>
              ) : null}
            </div>

            {!isMovement && !isEditing ? (
              <div className="space-y-3 rounded-control border border-border bg-surface-sunken p-3.5">
                <label className="flex items-start gap-2 text-[13px]">
                  <Checkbox
                    className="mt-0.5"
                    checked={Boolean(values.settleNow)}
                    onChange={(event) => {
                      setValue("settleNow", event.target.checked, { shouldValidate: true });
                      if (event.target.checked) {
                        setValue("isForecast", false);
                        setValue("installments", 1);
                      }
                    }}
                  />
                  <span>
                    <span className="font-medium">{kind === "income" ? "Já foi recebido" : "Já foi pago"}</span>
                    <span className="block text-[11.5px] text-muted">
                      Registra a baixa agora e atualiza o saldo da conta. Desmarque para lançar em {kind === "income" ? "contas a receber" : "contas a pagar"}.
                    </span>
                  </span>
                </label>

                {values.settleNow ? (
                  <FormField label={kind === "income" ? "Recebido em" : "Pago em"} htmlFor="fin-settled" error={errors.settledOn?.message}>
                    <Input id="fin-settled" type="date" {...register("settledOn")} className="sm:w-48" />
                  </FormField>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-start gap-2 text-[13px]">
                      <Checkbox
                        className="mt-0.5"
                        checked={Boolean(values.isForecast)}
                        onChange={(event) => setValue("isForecast", event.target.checked, { shouldValidate: true })}
                      />
                      <span>
                        <span className="font-medium">É só uma previsão</span>
                        <span className="block text-[11.5px] text-muted">Entra na projeção de caixa, mas não vira obrigação até ser confirmada.</span>
                      </span>
                    </label>
                    <FormField label="Parcelas" htmlFor="fin-installments" error={errors.installments?.message}>
                      <Controller
                        control={control}
                        name="installments"
                        render={({ field }) => (
                          <Input
                            id="fin-installments"
                            type="number"
                            min={1}
                            max={60}
                            value={field.value ?? 1}
                            onChange={(event) => field.onChange(Math.max(1, Number(event.target.value) || 1))}
                            onBlur={field.onBlur}
                          />
                        )}
                      />
                    </FormField>
                    {installmentValue ? (
                      <p className="text-[11.5px] text-muted sm:col-span-2">
                        {values.installments} parcelas mensais de {formatCurrency(installmentValue)} (a última ajusta os centavos), a partir do vencimento informado.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {/* Detalhes ----------------------------------------------------- */}
            {!isMovement ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Centro de custo" htmlFor="fin-cost-center">
                  <NativeSelect id="fin-cost-center" {...register("costCenterId")}>
                    <option value="">Nenhum</option>
                    {lookups.costCenters.map((center) => (
                      <option key={center.id} value={center.id}>
                        {center.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Imóvel relacionado" htmlFor="fin-property">
                  <NativeSelect id="fin-property" disabled={locked} {...register("propertyId")}>
                    <option value="">Nenhum</option>
                    {lookups.properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Nº do documento" htmlFor="fin-document" hint="Nota fiscal, boleto, recibo…">
                  <Input id="fin-document" {...register("documentNumber")} />
                </FormField>
              </div>
            ) : null}

            <FormField
              label={kind === "adjustment" ? "Justificativa" : "Observações"}
              htmlFor="fin-notes"
              required={kind === "adjustment"}
              error={errors.notes?.message}
              hint={kind === "adjustment" ? "Obrigatória (mínimo de 10 caracteres). Fica registrada na auditoria." : undefined}
            >
              <Textarea id="fin-notes" rows={3} {...register("notes")} />
            </FormField>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEditing ? "Salvar alterações" : `Registrar ${FIN_ENTRY_KIND_LABELS[kind].toLowerCase()}`}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function entryToFormValues(entry: {
  kind: FinEntryKind;
  description: string;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  transfer_account_id: string | null;
  adjustment_direction: "increase" | "decrease" | null;
  counterparty_id: string | null;
  cost_center_id: string | null;
  property_id: string | null;
  payment_method: string | null;
  competence_date: string;
  due_date: string | null;
  is_forecast: boolean;
  document_number: string | null;
  notes: string | null;
}): Partial<FinEntryFormValues> {
  return {
    kind: entry.kind,
    description: entry.description,
    amount: entry.amount,
    categoryId: entry.category_id ?? "",
    accountId: entry.account_id ?? "",
    transferAccountId: entry.transfer_account_id ?? "",
    adjustmentDirection: entry.adjustment_direction,
    counterpartyId: entry.counterparty_id ?? "",
    costCenterId: entry.cost_center_id ?? "",
    propertyId: entry.property_id ?? "",
    paymentMethod: (entry.payment_method ?? "") as FinEntryFormValues["paymentMethod"],
    competenceDate: entry.competence_date,
    dueDate: entry.due_date ?? "",
    isForecast: entry.is_forecast,
    settleNow: false,
    installments: 1,
    documentNumber: entry.document_number ?? "",
    notes: entry.notes ?? "",
  };
}

