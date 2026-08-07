"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { MoneyInput } from "@/components/finance/money-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SupplierAutocomplete } from "./supplier-autocomplete";
import { saveWorkEntry } from "./actions";
import {
  WORK_ENTRY_TYPES,
  WORK_ENTRY_UNITS,
  workEntrySchema,
  type WorkEntryFormValues,
} from "@/lib/validation/work";
import { WORK_ENTRY_TYPE_LABELS, WORK_ENTRY_UNIT_LABELS } from "@/lib/formatting/labels";

const ENTRY_TYPE_OPTIONS = WORK_ENTRY_TYPES.map((value) => ({
  value,
  label: WORK_ENTRY_TYPE_LABELS[value],
}));

interface WorkEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workId: string;
  suppliers: string[];
  entryId?: string;
  defaultValues?: Partial<WorkEntryFormValues>;
}

function emptyValues(workId: string): WorkEntryFormValues {
  return {
    workId,
    entryType: "material",
    entryDate: new Date().toISOString().slice(0, 10),
    description: "",
    category: "",
    supplierName: "",
    quantity: undefined as unknown as number,
    unit: "unidade",
    unitPrice: undefined as unknown as number,
    totalAmount: 0,
    totalIsManual: false,
    notes: "",
  };
}

export function WorkEntryDialog({
  open,
  onOpenChange,
  workId,
  suppliers,
  entryId,
  defaultValues,
}: WorkEntryDialogProps) {
  const router = useRouter();
  const isEditing = Boolean(entryId);
  const [pending, setPending] = React.useState(false);

  const form = useForm<WorkEntryFormValues>({
    resolver: zodResolver(workEntrySchema),
    mode: "onBlur",
    defaultValues: { ...emptyValues(workId), ...defaultValues },
  });

  const { control, register, handleSubmit, setValue, formState } = form;
  const errors = formState.errors;

  const values = useWatch({ control, defaultValue: form.getValues() }) as WorkEntryFormValues;

  const computedTotal = React.useMemo(() => {
    const quantity = Number(values.quantity) || 0;
    const unitPrice = Number(values.unitPrice) || 0;
    return Math.round(quantity * unitPrice * 100) / 100;
  }, [values.quantity, values.unitPrice]);

  React.useEffect(() => {
    if (!values.totalIsManual) {
      setValue("totalAmount", computedTotal, { shouldValidate: true });
    }
  }, [computedTotal, values.totalIsManual, setValue]);

  async function onSubmit(formValues: WorkEntryFormValues) {
    setPending(true);
    const result = await saveWorkEntry(formValues, entryId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      if (result.fieldErrors) {
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as keyof WorkEntryFormValues, { message });
        }
      }
      return;
    }

    toast.success(isEditing ? "Item atualizado." : "Item adicionado.");
    onOpenChange(false);
    router.refresh();
  }

  function onInvalid() {
    toast.error("Revise os campos destacados.");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar item" : "Adicionar item"}</DialogTitle>
          <DialogDescription>
            Material, serviço ou outro custo relacionado a esta obra.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          <FormField label="Tipo" htmlFor="entryType" required>
            <Controller
              control={control}
              name="entryType"
              render={({ field }) => (
                <Segmented
                  ariaLabel="Tipo do lançamento"
                  options={ENTRY_TYPE_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  className="w-full"
                />
              )}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Descrição"
              htmlFor="entry-description"
              required
              className="sm:col-span-2"
              error={errors.description?.message}
            >
              <Input id="entry-description" {...register("description")} />
            </FormField>

            <FormField label="Data" htmlFor="entry-date" required error={errors.entryDate?.message}>
              <Input id="entry-date" type="date" {...register("entryDate")} />
            </FormField>

            <FormField
              label="Categoria"
              htmlFor="entry-category"
              error={errors.category?.message}
              hint="Opcional. Ex.: hidráulica, elétrica."
            >
              <Input id="entry-category" {...register("category")} />
            </FormField>

            <FormField
              label="Fornecedor / prestador"
              htmlFor="entry-supplier"
              className="sm:col-span-2"
              error={errors.supplierName?.message}
            >
              <Controller
                control={control}
                name="supplierName"
                render={({ field }) => (
                  <SupplierAutocomplete
                    id="entry-supplier"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    suppliers={suppliers}
                  />
                )}
              />
            </FormField>

            <FormField label="Quantidade" htmlFor="entry-quantity" required error={errors.quantity?.message}>
              <Controller
                control={control}
                name="quantity"
                render={({ field }) => (
                  <Input
                    id="entry-quantity"
                    type="number"
                    step="0.001"
                    min="0"
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(event.target.value === "" ? undefined : Number(event.target.value))
                    }
                    onBlur={field.onBlur}
                  />
                )}
              />
            </FormField>

            <FormField label="Unidade" htmlFor="entry-unit" required error={errors.unit?.message}>
              <NativeSelect id="entry-unit" {...register("unit")}>
                {WORK_ENTRY_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {WORK_ENTRY_UNIT_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>

            <FormField
              label="Valor unitário"
              htmlFor="entry-unit-price"
              required
              error={errors.unitPrice?.message}
            >
              <Controller
                control={control}
                name="unitPrice"
                render={({ field }) => (
                  <MoneyInput
                    id="entry-unit-price"
                    value={field.value as number | null}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </FormField>

            <FormField label="Total" htmlFor="entry-total" error={errors.totalAmount?.message}>
              <Controller
                control={control}
                name="totalAmount"
                render={({ field }) => (
                  <MoneyInput
                    id="entry-total"
                    value={field.value as number | null}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={!values.totalIsManual}
                  />
                )}
              />
            </FormField>

            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <Checkbox
                checked={Boolean(values.totalIsManual)}
                onChange={(event) =>
                  setValue("totalIsManual", event.target.checked, { shouldValidate: true })
                }
              />
              Ajustar total manualmente (em vez de quantidade × valor unitário)
            </label>

            <FormField
              label="Observações"
              htmlFor="entry-notes"
              className="sm:col-span-2"
              error={errors.notes?.message}
            >
              <Textarea id="entry-notes" rows={2} {...register("notes")} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEditing ? "Salvar alterações" : "Adicionar item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
