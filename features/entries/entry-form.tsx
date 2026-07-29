"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";
import { SummaryPanel } from "@/components/finance/summary-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { calculateEntryTotals, calculateSplitAmount } from "@/lib/finance/engine";
import { entrySchema, type EntryFormValues } from "@/lib/validation/entry";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { baseAmountLabel } from "@/lib/formatting/labels";
import type { EntryType } from "@/lib/finance/types";
import type { BrokerRow, OrganizationSettingsRow } from "@/types/database";
import { saveEntry } from "./actions";

interface EntryFormProps {
  entryType: EntryType;
  brokers: BrokerRow[];
  settings: OrganizationSettingsRow;
  defaultValues?: Partial<EntryFormValues>;
  entryId?: string;
  /** Corretores inativos que já participam do lançamento em edição. */
  extraBrokers?: BrokerRow[];
  monthClosed?: boolean;
}

function defaultCommission(entryType: EntryType, settings: OrganizationSettingsRow) {
  return entryType === "sale"
    ? {
        mode: settings.default_sale_commission_mode,
        rate: settings.default_sale_commission_rate,
        fixed: settings.default_sale_commission_fixed_amount,
      }
    : {
        mode: settings.default_rental_commission_mode,
        rate: settings.default_rental_commission_rate,
        fixed: settings.default_rental_commission_fixed_amount,
      };
}

export function EntryForm({
  entryType,
  brokers,
  settings,
  defaultValues,
  entryId,
  extraBrokers = [],
  monthClosed = false,
}: EntryFormProps) {
  const router = useRouter();
  const isEditing = Boolean(entryId);
  const commissionDefaults = defaultCommission(entryType, settings);
  const listPath = entryType === "sale" ? "/vendas" : "/locacoes";

  const [pending, setPending] = React.useState(false);
  const [exceptionOpen, setExceptionOpen] = React.useState(false);

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entrySchema),
    mode: "onBlur",
    defaultValues: {
      entryType,
      entryDate: new Date().toISOString().slice(0, 10),
      description: "",
      reference: "",
      propertyType: "residential",
      baseAmount: undefined as unknown as number,
      commissionMode: commissionDefaults.mode,
      commissionRate: commissionDefaults.rate,
      commissionFixedAmount: commissionDefaults.fixed ?? undefined,
      notes: "",
      splits: [],
      exceptionConfirmed: false,
      exceptionReason: "",
      ...defaultValues,
    },
  });

  const { control, register, handleSubmit, setValue, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "splits" });

  // useWatch (em vez de watch()) evita re-renderizar o formulário inteiro a cada
  // tecla e é compatível com o React Compiler.
  const values = useWatch({ control, defaultValue: form.getValues() }) as EntryFormValues;
  const selectableBrokers = React.useMemo(() => {
    const map = new Map<string, BrokerRow>();
    for (const broker of [...brokers, ...extraBrokers]) map.set(broker.id, broker);
    return Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR"));
  }, [brokers, extraBrokers]);

  const totals = React.useMemo(
    () =>
      calculateEntryTotals(
        {
          mode: values.commissionMode,
          baseAmount: values.baseAmount,
          rate: values.commissionRate,
          fixedAmount: values.commissionFixedAmount,
        },
        (values.splits ?? []).map((split) => ({
          brokerId: split.brokerId,
          mode: split.splitMode,
          rate: split.splitRate,
          fixedAmount: split.splitFixedAmount,
        })),
      ),
    [
      values.commissionMode,
      values.baseAmount,
      values.commissionRate,
      values.commissionFixedAmount,
      values.splits,
    ],
  );

  const differsFromDefault =
    values.commissionMode === "percentage" &&
    commissionDefaults.mode === "percentage" &&
    values.commissionRate != null &&
    Number(values.commissionRate) !== Number(commissionDefaults.rate);

  // Aviso ao sair com alterações não salvas.
  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (formState.isDirty && !pending) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formState.isDirty, pending]);

  async function persist(formValues: EntryFormValues, createAnother: boolean) {
    setPending(true);
    const result = await saveEntry(formValues, entryId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      if (result.fieldErrors) {
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as keyof EntryFormValues, { message });
        }
      }
      return;
    }

    toast.success(isEditing ? "Lançamento atualizado." : "Lançamento registrado.");

    if (createAnother) {
      form.reset({
        entryType,
        entryDate: formValues.entryDate,
        description: "",
        reference: formValues.reference,
        propertyType: formValues.propertyType,
        baseAmount: undefined as unknown as number,
        commissionMode: commissionDefaults.mode,
        commissionRate: commissionDefaults.rate,
        commissionFixedAmount: commissionDefaults.fixed ?? undefined,
        notes: "",
        splits: [],
        exceptionConfirmed: false,
        exceptionReason: "",
      });
      router.refresh();
      return;
    }

    router.push(`${listPath}/${result.data.entryId}`);
    router.refresh();
  }

  function onInvalid() {
    // Receita líquida negativa não é erro de digitação: abre o fluxo de exceção.
    if (totals.isNegativeNet && !values.exceptionConfirmed) {
      setExceptionOpen(true);
      return;
    }
    toast.error("Revise os campos destacados.");
  }

  const submitAndClose = handleSubmit((data) => persist(data, false), onInvalid);
  const submitAndCreateAnother = handleSubmit((data) => persist(data, true), onInvalid);

  function addBroker() {
    const used = new Set((values.splits ?? []).map((split) => split.brokerId));
    const nextBroker = selectableBrokers.find((broker) => !used.has(broker.id) && broker.is_active);

    append({
      brokerId: nextBroker?.id ?? "",
      splitMode: nextBroker?.default_split_mode ?? "percentage",
      splitRate:
        nextBroker?.default_split_mode === "fixed"
          ? null
          : (nextBroker?.default_split_rate ?? settings.default_broker_split_rate),
      splitFixedAmount:
        nextBroker?.default_split_mode === "fixed"
          ? (nextBroker?.default_split_fixed_amount ?? null)
          : null,
    });
  }

  function onBrokerChange(index: number, brokerId: string) {
    const broker = selectableBrokers.find((item) => item.id === brokerId);
    setValue(`splits.${index}.brokerId`, brokerId, { shouldDirty: true, shouldValidate: true });

    if (!broker) return;

    setValue(`splits.${index}.splitMode`, broker.default_split_mode, { shouldDirty: true });
    if (broker.default_split_mode === "percentage") {
      setValue(
        `splits.${index}.splitRate`,
        broker.default_split_rate ?? settings.default_broker_split_rate,
        { shouldDirty: true },
      );
      setValue(`splits.${index}.splitFixedAmount`, null, { shouldDirty: true });
    } else {
      setValue(`splits.${index}.splitFixedAmount`, broker.default_split_fixed_amount ?? null, {
        shouldDirty: true,
      });
      setValue(`splits.${index}.splitRate`, null, { shouldDirty: true });
    }
  }

  const errors = formState.errors;

  return (
    <form onSubmit={submitAndClose} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        {monthClosed ? (
          <p className="flex items-start gap-2 rounded-card border border-warning bg-warning-soft px-4 py-3 text-[13px] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Este mês financeiro está fechado. Reabra o mês antes de realizar alterações.
          </p>
        ) : null}

        {/* Seção 1 — Informações ------------------------------------------ */}
        <section className="surface-card p-5">
          <h2 className="section-title">Informações</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Data da entrada"
              htmlFor="entryDate"
              required
              error={errors.entryDate?.message}
              hint="Define o mês financeiro do lançamento."
            >
              <Input id="entryDate" type="date" {...register("entryDate")} />
            </FormField>

            <FormField
              label="Tipo do imóvel"
              htmlFor="propertyType"
              error={errors.propertyType?.message}
            >
              <NativeSelect id="propertyType" {...register("propertyType")}>
                <option value="residential">Residencial</option>
                <option value="commercial">Comercial</option>
              </NativeSelect>
            </FormField>

            <FormField
              label="Descrição"
              htmlFor="description"
              required
              className="sm:col-span-2"
              error={errors.description?.message}
              hint={
                entryType === "sale"
                  ? "Exemplo: Venda Apartamento Centro — Bloco B."
                  : "Exemplo: Locação Residencial Rua das Palmeiras."
              }
            >
              <Input id="description" {...register("description")} />
            </FormField>

            <FormField
              label="Referência"
              htmlFor="reference"
              error={errors.reference?.message}
              hint="Opcional. Use a mesma referência para relacionar parcelas da mesma operação."
            >
              <Input id="reference" {...register("reference")} placeholder="VD-2026-001" />
            </FormField>

            <FormField
              label={baseAmountLabel(entryType)}
              htmlFor="baseAmount"
              required
              error={errors.baseAmount?.message}
            >
              <Controller
                control={control}
                name="baseAmount"
                render={({ field }) => (
                  <MoneyInput
                    id="baseAmount"
                    value={field.value as number | null}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    aria-invalid={Boolean(errors.baseAmount)}
                  />
                )}
              />
            </FormField>

            <FormField
              label="Observações"
              htmlFor="notes"
              className="sm:col-span-2"
              error={errors.notes?.message}
            >
              <Textarea id="notes" rows={3} {...register("notes")} />
            </FormField>
          </div>
        </section>

        {/* Seção 2 — Comissão --------------------------------------------- */}
        <section className="surface-card p-5">
          <h2 className="section-title">Comissão da imobiliária</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Forma de cálculo" htmlFor="commissionMode">
              <NativeSelect id="commissionMode" {...register("commissionMode")}>
                <option value="percentage">Percentual</option>
                <option value="fixed">Valor fixo</option>
              </NativeSelect>
            </FormField>

            {values.commissionMode === "percentage" ? (
              <FormField
                label="Percentual da comissão"
                htmlFor="commissionRate"
                required
                error={errors.commissionRate?.message}
              >
                <Controller
                  control={control}
                  name="commissionRate"
                  render={({ field }) => (
                    <PercentInput
                      id="commissionRate"
                      value={field.value as number | null}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.commissionRate)}
                    />
                  )}
                />
              </FormField>
            ) : (
              <FormField
                label="Valor fixo da comissão"
                htmlFor="commissionFixedAmount"
                required
                error={errors.commissionFixedAmount?.message}
              >
                <Controller
                  control={control}
                  name="commissionFixedAmount"
                  render={({ field }) => (
                    <MoneyInput
                      id="commissionFixedAmount"
                      value={field.value as number | null}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={Boolean(errors.commissionFixedAmount)}
                    />
                  )}
                />
              </FormField>
            )}
          </div>

          {differsFromDefault ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Esta comissão é diferente do padrão atual de {formatPercent(commissionDefaults.rate)}.
            </p>
          ) : null}

          <p className="mt-3 text-[13px] text-muted">
            Comissão bruta:{" "}
            <span className="font-semibold tabular text-foreground">
              {formatCurrency(totals.grossCommission)}
            </span>
          </p>
        </section>

        {/* Seção 3 — Corretores ------------------------------------------- */}
        <section className="surface-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="section-title">Corretores</h2>
              <p className="mt-0.5 text-xs text-subtle">
                Adicione quantos corretores participaram da operação.
              </p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addBroker}>
              <Plus />
              Adicionar corretor
            </Button>
          </div>

          {fields.length === 0 ? (
            <p className="mt-4 rounded-control bg-surface-muted px-4 py-6 text-center text-[13px] text-muted">
              Nenhum corretor adicionado. Toda a comissão ficará com a imobiliária.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {fields.map((field, index) => {
                const split = values.splits?.[index];
                const payout = calculateSplitAmount(totals.grossCommission, {
                  mode: split?.splitMode ?? "percentage",
                  rate: split?.splitRate,
                  fixedAmount: split?.splitFixedAmount,
                });
                const splitErrors = errors.splits?.[index];

                return (
                  <li
                    key={field.id}
                    className="rounded-control border border-border p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <FormField
                        label="Corretor"
                        htmlFor={`splits.${index}.brokerId`}
                        required
                        error={splitErrors?.brokerId?.message}
                      >
                        <NativeSelect
                          id={`splits.${index}.brokerId`}
                          value={split?.brokerId ?? ""}
                          onChange={(event) => onBrokerChange(index, event.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {selectableBrokers.map((broker) => (
                            <option key={broker.id} value={broker.id}>
                              {broker.full_name}
                              {broker.is_active ? "" : " (inativo)"}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>

                      <FormField label="Forma do repasse" htmlFor={`splits.${index}.splitMode`}>
                        <NativeSelect
                          id={`splits.${index}.splitMode`}
                          {...register(`splits.${index}.splitMode` as const)}
                        >
                          <option value="percentage">Percentual</option>
                          <option value="fixed">Valor fixo</option>
                        </NativeSelect>
                      </FormField>

                      {split?.splitMode === "fixed" ? (
                        <FormField
                          label="Valor do repasse"
                          htmlFor={`splits.${index}.splitFixedAmount`}
                          required
                          error={splitErrors?.splitFixedAmount?.message}
                        >
                          <Controller
                            control={control}
                            name={`splits.${index}.splitFixedAmount` as const}
                            render={({ field: amountField }) => (
                              <MoneyInput
                                id={`splits.${index}.splitFixedAmount`}
                                value={amountField.value as number | null}
                                onChange={amountField.onChange}
                                onBlur={amountField.onBlur}
                              />
                            )}
                          />
                        </FormField>
                      ) : (
                        <FormField
                          label="Percentual do repasse"
                          htmlFor={`splits.${index}.splitRate`}
                          required
                          error={splitErrors?.splitRate?.message}
                        >
                          <Controller
                            control={control}
                            name={`splits.${index}.splitRate` as const}
                            render={({ field: rateField }) => (
                              <PercentInput
                                id={`splits.${index}.splitRate`}
                                value={rateField.value as number | null}
                                onChange={rateField.onChange}
                                onBlur={rateField.onBlur}
                              />
                            )}
                          />
                        </FormField>
                      )}

                      <div className="flex items-end justify-end pb-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          aria-label="Remover corretor do lançamento"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-muted">
                      Repasse calculado:{" "}
                      <span className="font-semibold tabular text-foreground">
                        {formatCurrency(payout)}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Ações ----------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEditing ? "Salvar alterações" : "Salvar lançamento"}
          </Button>

          {!isEditing ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => submitAndCreateAnother()}
            >
              Salvar e criar outro
            </Button>
          ) : null}

          <Button asChild variant="ghost" type="button">
            <Link href={entryId ? `${listPath}/${entryId}` : listPath}>Cancelar</Link>
          </Button>
        </div>
      </div>

      {/* Resumo ------------------------------------------------------------ */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <SummaryPanel entryType={entryType} baseAmount={values.baseAmount} totals={totals} />
      </div>

      {/* Exceção financeira ------------------------------------------------ */}
      <Dialog open={exceptionOpen} onOpenChange={setExceptionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar exceção financeira</DialogTitle>
            <DialogDescription>
              A soma dos repasses aos corretores ({formatCurrency(totals.totalBrokerPayout)}) é
              maior que a comissão bruta ({formatCurrency(totals.grossCommission)}). Isso fará com
              que a receita líquida da imobiliária fique negativa (
              {formatCurrency(totals.netCompanyRevenue)}).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border-strong"
                checked={Boolean(values.exceptionConfirmed)}
                onChange={(event) =>
                  setValue("exceptionConfirmed", event.target.checked, { shouldValidate: true })
                }
              />
              Confirmar exceção financeira
            </label>

            <FormField
              label="Justificativa"
              htmlFor="exceptionReason"
              required
              error={errors.exceptionReason?.message}
              hint="Mínimo de 10 caracteres. A justificativa fica registrada na auditoria."
            >
              <Textarea id="exceptionReason" rows={3} {...register("exceptionReason")} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setExceptionOpen(false)}>
              Voltar e revisar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending || !values.exceptionConfirmed}
              onClick={async () => {
                const isValid = await form.trigger();
                if (!isValid) return;
                setExceptionOpen(false);
                await persist(form.getValues(), false);
              }}
            >
              Confirmar e salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
