"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
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
import { deleteWorkAttachment, saveWorkEntry, uploadWorkAttachment } from "./actions";
import { ATTACHMENT_ACCEPT, describeFileSize, validateAttachmentFile } from "./attachment-files";
import {
  WORK_ENTRY_TYPES,
  WORK_ENTRY_UNITS,
  workEntrySchema,
  type WorkEntryFormValues,
} from "@/lib/validation/work";
import {
  WORK_ATTACHMENT_CATEGORY_LABELS,
  WORK_ENTRY_TYPE_LABELS,
  WORK_ENTRY_UNIT_LABELS,
} from "@/lib/formatting/labels";
import type { WorkAttachmentCategory, WorkAttachmentRow } from "@/types/database";

const ENTRY_TYPE_OPTIONS = WORK_ENTRY_TYPES.map((value) => ({
  value,
  label: WORK_ENTRY_TYPE_LABELS[value],
}));

const INVOICE_CATEGORIES: WorkAttachmentCategory[] = ["nota_fiscal", "recibo", "comprovante", "orcamento"];

interface WorkEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workId: string;
  suppliers: string[];
  entryId?: string;
  defaultValues?: Partial<WorkEntryFormValues>;
  /** Anexos já vinculados ao item em edição. */
  linkedAttachments?: WorkAttachmentRow[];
  duplicating?: boolean;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyValues(workId: string): WorkEntryFormValues {
  return {
    workId,
    entryType: "material",
    entryDate: today(),
    description: "",
    category: "",
    supplierName: "",
    quantity: undefined as unknown as number,
    unit: "unidade",
    unitPrice: undefined as unknown as number,
    totalAmount: 0,
    totalIsManual: false,
    isPaid: false,
    paidAt: "",
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
  linkedAttachments = [],
  duplicating = false,
}: WorkEntryDialogProps) {
  const router = useRouter();
  const isEditing = Boolean(entryId);
  const [pending, setPending] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [invoiceCategory, setInvoiceCategory] = React.useState<WorkAttachmentCategory>("nota_fiscal");
  const [removedAttachmentIds, setRemovedAttachmentIds] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  function onFilesPicked(list: FileList | null) {
    if (!list) return;
    const accepted: File[] = [];
    for (const file of Array.from(list)) {
      const problem = validateAttachmentFile(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        continue;
      }
      accepted.push(file);
    }
    setFiles((current) => [...current, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function removeLinkedAttachment(attachmentId: string) {
    const result = await deleteWorkAttachment(attachmentId, workId);
    if (result.status === "error") {
      toast.error(result.message);
      return;
    }
    setRemovedAttachmentIds((current) => [...current, attachmentId]);
    toast.success("Anexo removido.");
  }

  async function onSubmit(formValues: WorkEntryFormValues) {
    setPending(true);
    const result = await saveWorkEntry(formValues, entryId);

    if (result.status === "error") {
      setPending(false);
      toast.error(result.message);
      if (result.fieldErrors) {
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as keyof WorkEntryFormValues, { message });
        }
      }
      return;
    }

    let uploaded = 0;
    let failed = 0;
    for (const file of files) {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("workId", workId);
      formData.set("workEntryId", result.data.entryId);
      formData.set("category", invoiceCategory);
      const upload = await uploadWorkAttachment(formData);
      if (upload.status === "ok") uploaded += 1;
      else {
        failed += 1;
        toast.error(`${file.name}: ${upload.message}`);
      }
    }
    setPending(false);

    const base = isEditing ? "Item atualizado." : "Item adicionado.";
    if (uploaded > 0) {
      toast.success(`${base} ${uploaded} ${uploaded === 1 ? "anexo enviado" : "anexos enviados"}.`);
    } else if (failed === 0) {
      toast.success(base);
    } else {
      toast.warning(`${base} Nenhum anexo foi enviado — tente de novo pela aba Fotos e documentos.`);
    }

    onOpenChange(false);
    router.refresh();
  }

  function onInvalid() {
    toast.error("Revise os campos destacados.");
  }

  const visibleLinked = linkedAttachments.filter((attachment) => !removedAttachmentIds.includes(attachment.id));
  const title = duplicating ? "Duplicar item" : isEditing ? "Editar item" : "Adicionar item";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
          </div>

          {/* Pagamento ------------------------------------------------------ */}
          <div className="rounded-control border border-border bg-surface-sunken p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px] font-medium">
                <Checkbox
                  checked={Boolean(values.isPaid)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setValue("isPaid", checked, { shouldDirty: true, shouldValidate: true });
                    if (checked && !values.paidAt) setValue("paidAt", today(), { shouldDirty: true });
                    if (!checked) setValue("paidAt", "", { shouldDirty: true });
                  }}
                />
                Pago
              </label>
              {values.isPaid ? (
                <FormField label="Data do pagamento" htmlFor="entry-paid-at" error={errors.paidAt?.message} className="w-44">
                  <Input
                    id="entry-paid-at"
                    type="date"
                    {...register("paidAt", { setValueAs: (value: string) => (value === "" ? null : value) })}
                  />
                </FormField>
              ) : (
                <span className="text-[12px] text-subtle">Marque quando o pagamento for feito.</span>
              )}
            </div>
          </div>

          {/* Nota fiscal / comprovante ------------------------------------- */}
          <div className="rounded-control border border-dashed border-border-strong p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <Paperclip className="size-3.5" />
                Nota fiscal / comprovante
              </p>
              <div className="flex items-center gap-2">
                <NativeSelect
                  aria-label="Categoria do anexo"
                  className="h-8 text-[12.5px]"
                  value={invoiceCategory}
                  onChange={(event) => setInvoiceCategory(event.target.value as WorkAttachmentCategory)}
                >
                  {INVOICE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {WORK_ATTACHMENT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Escolher arquivos
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              onChange={(event) => onFilesPicked(event.target.files)}
            />
            <p className="mt-1.5 text-[12px] text-subtle">PDF, JPG, PNG ou WEBP — até 10 MB cada. Os arquivos ficam vinculados a este item.</p>

            {visibleLinked.length > 0 || files.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {visibleLinked.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FileText className="size-3.5 shrink-0 text-subtle" />
                      <span className="truncate">{attachment.file_name}</span>
                      <span className="shrink-0 text-subtle">· {WORK_ATTACHMENT_CATEGORY_LABELS[attachment.category]}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${attachment.file_name}`}
                      onClick={() => removeLinkedAttachment(attachment.id)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Paperclip className="size-3.5 shrink-0 text-accent" />
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-subtle">· {describeFileSize(file.size)} · novo</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Descartar ${file.name}`}
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <FormField label="Observações" htmlFor="entry-notes" error={errors.notes?.message}>
            <Textarea id="entry-notes" rows={2} {...register("notes")} />
          </FormField>

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
