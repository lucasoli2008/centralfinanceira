"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { MoneyInput, PercentInput } from "@/components/finance/money-input";
import {
  updateFinancialSettings,
  updateOrganization,
  type OrganizationValues,
  type SettingsValues,
} from "./actions";
import type { OrganizationRow, OrganizationSettingsRow } from "@/types/database";
import type { AmountMode } from "@/lib/finance/types";

function SubmitButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function OrganizationForm({
  organization,
  disabled,
}: {
  organization: OrganizationRow;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [values, setValues] = React.useState<OrganizationValues>({
    name: organization.name,
    legalName: organization.legal_name ?? "",
    documentNumber: organization.document_number ?? "",
    accentColor: organization.accent_color,
    logoUrl: organization.logo_url ?? "",
  });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateOrganization(values);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Identidade da empresa atualizada.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="surface-card space-y-4 p-5">
      <div>
        <h2 className="section-title">Empresa e marca</h2>
        <p className="mt-0.5 text-xs text-subtle">
          Nome exibido, logotipo e cor principal são aplicados na interface e nos PDFs sem alterar
          código.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome exibido" htmlFor="name" required>
          <Input
            id="name"
            value={values.name}
            disabled={disabled}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </FormField>

        <FormField label="Razão social" htmlFor="legalName">
          <Input
            id="legalName"
            value={values.legalName ?? ""}
            disabled={disabled}
            onChange={(event) => setValues({ ...values, legalName: event.target.value })}
          />
        </FormField>

        <FormField label="CNPJ" htmlFor="documentNumber">
          <Input
            id="documentNumber"
            value={values.documentNumber ?? ""}
            disabled={disabled}
            onChange={(event) => setValues({ ...values, documentNumber: event.target.value })}
          />
        </FormField>

        <FormField
          label="URL do logotipo"
          htmlFor="logoUrl"
          hint="Imagem hospedada em HTTPS (PNG ou SVG). Aparece na sidebar e nos relatórios."
        >
          <Input
            id="logoUrl"
            value={values.logoUrl ?? ""}
            disabled={disabled}
            placeholder="https://…/logo.png"
            onChange={(event) => setValues({ ...values, logoUrl: event.target.value })}
          />
        </FormField>

        <FormField
          label="Cor principal"
          htmlFor="accentColor"
          hint="Use um tom escuro o suficiente para manter contraste com o texto branco."
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Selecionar cor principal"
              className="h-9 w-12 cursor-pointer rounded-control border border-border-strong bg-surface"
              value={values.accentColor}
              disabled={disabled}
              onChange={(event) => setValues({ ...values, accentColor: event.target.value })}
            />
            <Input
              id="accentColor"
              value={values.accentColor}
              disabled={disabled}
              onChange={(event) => setValues({ ...values, accentColor: event.target.value })}
            />
          </div>
        </FormField>
      </div>

      {!disabled ? <SubmitButton pending={pending} label="Salvar identidade" /> : null}
    </form>
  );
}

export function FinancialSettingsForm({
  settings,
  disabled,
  scope,
}: {
  settings: OrganizationSettingsRow;
  disabled: boolean;
  scope: "financeiro" | "relatorios";
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [values, setValues] = React.useState<SettingsValues>({
    defaultSaleCommissionMode: settings.default_sale_commission_mode,
    defaultSaleCommissionRate: settings.default_sale_commission_rate,
    defaultSaleCommissionFixedAmount: settings.default_sale_commission_fixed_amount,
    defaultRentalCommissionMode: settings.default_rental_commission_mode,
    defaultRentalCommissionRate: settings.default_rental_commission_rate,
    defaultRentalCommissionFixedAmount: settings.default_rental_commission_fixed_amount,
    defaultBrokerSplitRate: settings.default_broker_split_rate,
    monthlyClosingEnabled: settings.monthly_closing_enabled,
    reportHeader: settings.report_header ?? "",
    reportFooter: settings.report_footer ?? "",
  });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateFinancialSettings(values);
    setPending(false);

    if (result.status === "error") {
      toast.error(result.message);
      return;
    }

    toast.success("Configurações salvas. Lançamentos anteriores não foram alterados.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="surface-card space-y-4 p-5">
      {scope === "financeiro" ? (
        <>
          <div>
            <h2 className="section-title">Padrões financeiros</h2>
            <p className="mt-0.5 text-xs text-subtle">
              Estes valores apenas preenchem novos formulários. Lançamentos já registrados guardam
              os próprios percentuais e nunca mudam.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Forma padrão — venda" htmlFor="saleMode">
              <NativeSelect
                id="saleMode"
                value={values.defaultSaleCommissionMode}
                disabled={disabled}
                onChange={(event) =>
                  setValues({
                    ...values,
                    defaultSaleCommissionMode: event.target.value as AmountMode,
                  })
                }
              >
                <option value="percentage">Percentual</option>
                <option value="fixed">Valor fixo</option>
              </NativeSelect>
            </FormField>

            {values.defaultSaleCommissionMode === "percentage" ? (
              <FormField label="Comissão padrão de venda" htmlFor="saleRate">
                <PercentInput
                  id="saleRate"
                  disabled={disabled}
                  value={values.defaultSaleCommissionRate}
                  onChange={(value) =>
                    setValues({ ...values, defaultSaleCommissionRate: value ?? 0 })
                  }
                />
              </FormField>
            ) : (
              <FormField label="Comissão fixa padrão de venda" htmlFor="saleFixed">
                <MoneyInput
                  id="saleFixed"
                  disabled={disabled}
                  value={values.defaultSaleCommissionFixedAmount ?? null}
                  onChange={(value) =>
                    setValues({ ...values, defaultSaleCommissionFixedAmount: value })
                  }
                />
              </FormField>
            )}

            <FormField label="Forma padrão — locação" htmlFor="rentalMode">
              <NativeSelect
                id="rentalMode"
                value={values.defaultRentalCommissionMode}
                disabled={disabled}
                onChange={(event) =>
                  setValues({
                    ...values,
                    defaultRentalCommissionMode: event.target.value as AmountMode,
                  })
                }
              >
                <option value="percentage">Percentual</option>
                <option value="fixed">Valor fixo</option>
              </NativeSelect>
            </FormField>

            {values.defaultRentalCommissionMode === "percentage" ? (
              <FormField
                label="Comissão padrão de locação"
                htmlFor="rentalRate"
                hint="O padrão do mercado é 100% do primeiro aluguel."
              >
                <PercentInput
                  id="rentalRate"
                  disabled={disabled}
                  value={values.defaultRentalCommissionRate}
                  onChange={(value) =>
                    setValues({ ...values, defaultRentalCommissionRate: value ?? 0 })
                  }
                />
              </FormField>
            ) : (
              <FormField label="Comissão fixa padrão de locação" htmlFor="rentalFixed">
                <MoneyInput
                  id="rentalFixed"
                  disabled={disabled}
                  value={values.defaultRentalCommissionFixedAmount ?? null}
                  onChange={(value) =>
                    setValues({ ...values, defaultRentalCommissionFixedAmount: value })
                  }
                />
              </FormField>
            )}

            <FormField
              label="Percentual padrão de repasse"
              htmlFor="brokerRate"
              hint="Usado quando o corretor não tem percentual próprio."
            >
              <PercentInput
                id="brokerRate"
                disabled={disabled}
                value={values.defaultBrokerSplitRate}
                onChange={(value) => setValues({ ...values, defaultBrokerSplitRate: value ?? 0 })}
              />
            </FormField>

            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="size-4"
                  disabled={disabled}
                  checked={values.monthlyClosingEnabled}
                  onChange={(event) =>
                    setValues({ ...values, monthlyClosingEnabled: event.target.checked })
                  }
                />
                Ativar fechamento mensal
              </label>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 className="section-title">Relatórios</h2>
            <p className="mt-0.5 text-xs text-subtle">
              Cabeçalho e rodapé aparecem em todos os PDFs gerados pelo sistema.
            </p>
          </div>

          <FormField label="Cabeçalho dos relatórios" htmlFor="reportHeader">
            <Input
              id="reportHeader"
              disabled={disabled}
              value={values.reportHeader ?? ""}
              placeholder="Roberta Oliveira Imóveis · Central Financeira"
              onChange={(event) => setValues({ ...values, reportHeader: event.target.value })}
            />
          </FormField>

          <FormField label="Rodapé dos relatórios" htmlFor="reportFooter">
            <Textarea
              id="reportFooter"
              rows={2}
              disabled={disabled}
              value={values.reportFooter ?? ""}
              placeholder="Documento gerado automaticamente · Confidencial"
              onChange={(event) => setValues({ ...values, reportFooter: event.target.value })}
            />
          </FormField>
        </>
      )}

      {!disabled ? <SubmitButton pending={pending} label="Salvar configurações" /> : null}
    </form>
  );
}
