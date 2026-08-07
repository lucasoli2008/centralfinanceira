"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { StepSection } from "@/components/ui/step";
import {
  WORK_CATEGORIES,
  WORK_PRIORITIES,
  WORK_STATUSES,
  workSchema,
  type WorkFormValues,
} from "@/lib/validation/work";
import {
  WORK_CATEGORY_LABELS,
  WORK_PRIORITY_LABELS,
  WORK_STATUS_LABELS,
} from "@/lib/formatting/labels";
import { saveWork } from "./actions";

interface WorkFormProps {
  workId?: string;
  defaultValues?: Partial<WorkFormValues>;
}

const EMPTY_VALUES: WorkFormValues = {
  title: "",
  propertyLabel: "",
  address: "",
  ownerLabel: "",
  responsibleName: "",
  description: "",
  status: "planejada",
  category: "manutencao",
  priority: "normal",
  requestedAt: new Date().toISOString().slice(0, 10),
  startedAt: "",
  expectedAt: "",
  completedAt: "",
  notes: "",
};

export function WorkForm({ workId, defaultValues }: WorkFormProps) {
  const router = useRouter();
  const isEditing = Boolean(workId);
  const [pending, setPending] = React.useState(false);

  const form = useForm<WorkFormValues>({
    resolver: zodResolver(workSchema),
    mode: "onBlur",
    defaultValues: { ...EMPTY_VALUES, ...defaultValues },
  });

  const { register, handleSubmit, formState } = form;
  const errors = formState.errors;

  const dateFieldOptions = { setValueAs: (value: string) => (value === "" ? null : value) };

  async function onSubmit(values: WorkFormValues) {
    setPending(true);
    const result = await saveWork(values, workId);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      if (result.fieldErrors) {
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as keyof WorkFormValues, { message });
        }
      }
      return;
    }

    toast.success(isEditing ? "Obra atualizada." : "Obra cadastrada.");
    router.push(`/obras/${result.data.workId}`);
    router.refresh();
  }

  function onInvalid() {
    toast.error("Revise os campos destacados.");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="max-w-3xl space-y-4">
      <StepSection
        index={1}
        title="Identificação"
        description="Qual imóvel e proprietário estão relacionados a esta obra."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Título da obra"
            htmlFor="title"
            required
            className="sm:col-span-2"
            error={errors.title?.message}
            hint="Exemplo: Reforma banheiro social — Apto 302."
          >
            <Input id="title" {...register("title")} />
          </FormField>

          <FormField label="Imóvel" htmlFor="propertyLabel" required error={errors.propertyLabel?.message}>
            <Input id="propertyLabel" {...register("propertyLabel")} placeholder="Apto 302 — Edifício Aurora" />
          </FormField>

          <FormField label="Proprietário" htmlFor="ownerLabel" required error={errors.ownerLabel?.message}>
            <Input id="ownerLabel" {...register("ownerLabel")} />
          </FormField>

          <FormField
            label="Endereço"
            htmlFor="address"
            required
            className="sm:col-span-2"
            error={errors.address?.message}
          >
            <Input id="address" {...register("address")} />
          </FormField>
        </div>
      </StepSection>

      <StepSection
        index={2}
        title="Informações da obra"
        description="Descrição, categoria e responsável pelo acompanhamento."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Descrição"
            htmlFor="description"
            required
            className="sm:col-span-2"
            error={errors.description?.message}
          >
            <Textarea id="description" rows={3} {...register("description")} />
          </FormField>

          <FormField label="Categoria" htmlFor="category" required error={errors.category?.message}>
            <NativeSelect id="category" {...register("category")}>
              {WORK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {WORK_CATEGORY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Prioridade" htmlFor="priority" required error={errors.priority?.message}>
            <NativeSelect id="priority" {...register("priority")}>
              {WORK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {WORK_PRIORITY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Status" htmlFor="status" required error={errors.status?.message}>
            <NativeSelect id="status" {...register("status")}>
              {WORK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {WORK_STATUS_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </FormField>

          <FormField
            label="Responsável interno"
            htmlFor="responsibleName"
            required
            error={errors.responsibleName?.message}
            hint="Quem acompanha a obra pela imobiliária."
          >
            <Input id="responsibleName" {...register("responsibleName")} />
          </FormField>
        </div>
      </StepSection>

      <StepSection index={3} title="Datas" description="Solicitação, início, previsão e conclusão da obra.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Data da solicitação" htmlFor="requestedAt" error={errors.requestedAt?.message}>
            <Input id="requestedAt" type="date" {...register("requestedAt", dateFieldOptions)} />
          </FormField>

          <FormField label="Data de início" htmlFor="startedAt" error={errors.startedAt?.message}>
            <Input id="startedAt" type="date" {...register("startedAt", dateFieldOptions)} />
          </FormField>

          <FormField label="Previsão de conclusão" htmlFor="expectedAt" error={errors.expectedAt?.message}>
            <Input id="expectedAt" type="date" {...register("expectedAt", dateFieldOptions)} />
          </FormField>

          <FormField label="Data de conclusão" htmlFor="completedAt" error={errors.completedAt?.message}>
            <Input id="completedAt" type="date" {...register("completedAt", dateFieldOptions)} />
          </FormField>
        </div>
      </StepSection>

      <StepSection index={4} title="Observações" description="Informações adicionais sobre a obra.">
        <FormField label="Observações" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" rows={3} {...register("notes")} />
        </FormField>
      </StepSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {isEditing ? "Salvar alterações" : "Salvar obra"}
        </Button>

        <Button asChild variant="ghost" type="button">
          <Link href={workId ? `/obras/${workId}` : "/obras/lista"}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
