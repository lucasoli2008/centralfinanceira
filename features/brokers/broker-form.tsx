"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect } from "@/components/ui/field";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brokerSchema } from "@/lib/validation/entry";
import { saveBroker, type BrokerFormValues } from "./actions";
import type { BrokerRow } from "@/types/database";

interface BrokerFormDialogProps {
  broker?: BrokerRow;
  defaultSplitRate: number;
  trigger?: React.ReactNode;
}

export function BrokerFormDialog({ broker, defaultSplitRate, trigger }: BrokerFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [duplicateWarning, setDuplicateWarning] = React.useState<string | null>(null);

  const form = useForm<BrokerFormValues>({
    resolver: zodResolver(brokerSchema),
    defaultValues: {
      fullName: broker?.full_name ?? "",
      shortName: broker?.short_name ?? "",
      email: broker?.email ?? "",
      phone: broker?.phone ?? "",
      documentNumber: broker?.document_number ?? "",
      defaultSplitMode: broker?.default_split_mode ?? "percentage",
      defaultSplitRate: broker?.default_split_rate ?? defaultSplitRate,
      defaultSplitFixedAmount: broker?.default_split_fixed_amount ?? null,
      isActive: broker?.is_active ?? true,
      confirmDuplicateName: false,
    },
  });

  const { control, register, handleSubmit, setValue, formState } = form;

  // useWatch em vez de watch(): não re-renderiza o formulário inteiro e é
  // compatível com o React Compiler.
  const mode = useWatch({ control, name: "defaultSplitMode" });
  const defaultRate = useWatch({ control, name: "defaultSplitRate" });
  const defaultFixed = useWatch({ control, name: "defaultSplitFixedAmount" });

  const onSubmit = handleSubmit(async (values) => {
    setPending(true);
    const result = await saveBroker(values, broker?.id);
    setPending(false);

    if (result.status === "error") {
      if (result.message.includes("mesmo nome")) {
        setDuplicateWarning(result.message);
        return;
      }
      toast.error(result.message);
      return;
    }

    toast.success(broker ? "Corretor atualizado." : "Corretor cadastrado.");
    setOpen(false);
    setDuplicateWarning(null);
    form.reset(values);
    router.refresh();
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDuplicateWarning(null);
      }}
    >
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button>
            <Plus />
            Novo corretor
          </Button>
        )}
      </span>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{broker ? "Editar corretor" : "Novo corretor"}</DialogTitle>
          <DialogDescription>
            Corretores não têm login: são registros usados nos cálculos e relatórios. O percentual
            padrão apenas preenche novos repasses e nunca altera lançamentos anteriores.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Nome completo"
              htmlFor="fullName"
              required
              className="sm:col-span-2"
              error={formState.errors.fullName?.message}
            >
              <Input id="fullName" {...register("fullName")} />
            </FormField>

            <FormField label="Nome curto" htmlFor="shortName" error={formState.errors.shortName?.message}>
              <Input id="shortName" {...register("shortName")} placeholder="Usado em tabelas" />
            </FormField>

            <FormField label="CRECI" htmlFor="documentNumber">
              <Input id="documentNumber" {...register("documentNumber")} />
            </FormField>

            <FormField label="E-mail" htmlFor="email" error={formState.errors.email?.message}>
              <Input id="email" type="email" {...register("email")} />
            </FormField>

            <FormField label="Telefone" htmlFor="phone">
              <Input id="phone" {...register("phone")} placeholder="(22) 99999-9999" />
            </FormField>

            <FormField label="Forma padrão do repasse" htmlFor="defaultSplitMode">
              <NativeSelect id="defaultSplitMode" {...register("defaultSplitMode")}>
                <option value="percentage">Percentual</option>
                <option value="fixed">Valor fixo</option>
              </NativeSelect>
            </FormField>

            {mode === "percentage" ? (
              <FormField
                label="Percentual padrão"
                htmlFor="defaultSplitRate"
                error={formState.errors.defaultSplitRate?.message}
              >
                <PercentInput
                  id="defaultSplitRate"
                  value={defaultRate as number | null}
                  onChange={(value) => setValue("defaultSplitRate", value)}
                />
              </FormField>
            ) : (
              <FormField
                label="Valor fixo padrão"
                htmlFor="defaultSplitFixedAmount"
                error={formState.errors.defaultSplitFixedAmount?.message}
              >
                <MoneyInput
                  id="defaultSplitFixedAmount"
                  value={defaultFixed as number | null}
                  onChange={(value) => setValue("defaultSplitFixedAmount", value)}
                />
              </FormField>
            )}

            <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" className="size-4" {...register("isActive")} />
              Corretor ativo (aparece na seleção de novos lançamentos)
            </label>
          </div>

          {duplicateWarning ? (
            <div className="rounded-control bg-warning-soft px-3 py-2 text-[13px] text-warning">
              <p>{duplicateWarning}</p>
              <label className="mt-2 flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="size-4"
                  onChange={(event) => setValue("confirmDuplicateName", event.target.checked)}
                />
                Cadastrar mesmo assim
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {broker ? "Salvar alterações" : "Cadastrar corretor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrokerStatusToggle({ broker }: { broker: BrokerRow }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const { setBrokerActive } = await import("./actions");
        const result = await setBrokerActive(broker.id, !broker.is_active);
        setPending(false);

        if (result.status === "error") {
          toast.error(result.message);
          return;
        }

        toast.success(broker.is_active ? "Corretor inativado." : "Corretor reativado.");
        router.refresh();
      }}
    >
      {broker.is_active ? "Inativar" : "Reativar"}
    </Button>
  );
}
