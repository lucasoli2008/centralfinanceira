/**
 * Validação do Controle Financeiro — usada no cliente (React Hook Form) e no
 * servidor (Server Actions). O banco repete as regras críticas nas RPCs
 * app_fin_* (supabase/migrations/0010_finance_core.sql).
 */

import { z } from "zod";
import { hasValidMoneyPrecision } from "@/lib/formatting/number";

const moneySchema = z
  .number({ message: "Informe um valor válido." })
  .finite("Informe um valor válido.")
  .refine(hasValidMoneyPrecision, "Use no máximo duas casas decimais.");

const positiveMoney = moneySchema.refine((value) => value > 0, "Informe um valor maior que zero.");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Data inválida.");

const optionalDate = dateSchema.nullable().optional().or(z.literal(""));
const optionalId = z.string().uuid().nullable().optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres.`).nullable().optional();

export const FIN_ENTRY_KINDS = ["income", "expense", "transfer", "adjustment"] as const;
export const FIN_ACCOUNT_KINDS = ["checking", "savings", "cash", "digital", "investment"] as const;
export const FIN_NATURES = [
  "own_revenue",
  "other_revenue",
  "deduction",
  "direct_cost",
  "operating_expense",
  "other_expense",
  "third_party",
  "deposit",
  "equity",
] as const;
export const FIN_COUNTERPARTY_KINDS = [
  "supplier",
  "client",
  "owner",
  "tenant",
  "broker",
  "partner",
  "government",
  "bank",
  "other",
  "employee",
] as const;
export const FIN_PAYMENT_METHODS = [
  "pix",
  "ted",
  "boleto",
  "cartao_credito",
  "cartao_debito",
  "dinheiro",
  "cheque",
  "debito_automatico",
  "outro",
] as const;

export const finEntrySchema = z
  .object({
    kind: z.enum(FIN_ENTRY_KINDS, { message: "Escolha o tipo do lançamento." }),
    description: z.string().trim().min(1, "Informe a descrição.").max(200, "Use no máximo 200 caracteres."),
    amount: positiveMoney,
    categoryId: optionalId,
    accountId: optionalId,
    transferAccountId: optionalId,
    adjustmentDirection: z.enum(["increase", "decrease"]).nullable().optional(),
    counterpartyId: optionalId,
    costCenterId: optionalId,
    propertyId: optionalId,
    paymentMethod: z.enum(FIN_PAYMENT_METHODS).nullable().optional().or(z.literal("")),
    competenceDate: dateSchema,
    dueDate: optionalDate,
    isForecast: z.boolean().default(false),
    settleNow: z.boolean().default(false),
    settledOn: optionalDate,
    installments: z.number().int().min(1).max(60).default(1),
    documentNumber: optionalText(60),
    notes: optionalText(2000),
  })
  .superRefine((entry, ctx) => {
    if ((entry.kind === "income" || entry.kind === "expense") && !entry.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Selecione uma categoria." });
    }
    if (entry.kind === "transfer") {
      if (!entry.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "Escolha a conta de origem." });
      if (!entry.transferAccountId) {
        ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Escolha a conta de destino." });
      } else if (entry.transferAccountId === entry.accountId) {
        ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Origem e destino precisam ser diferentes." });
      }
    }
    if (entry.kind === "adjustment") {
      if (!entry.accountId) ctx.addIssue({ code: "custom", path: ["accountId"], message: "Escolha a conta." });
      if (!entry.adjustmentDirection) {
        ctx.addIssue({ code: "custom", path: ["adjustmentDirection"], message: "Informe se o ajuste aumenta ou diminui." });
      }
      if ((entry.notes ?? "").trim().length < 10) {
        ctx.addIssue({ code: "custom", path: ["notes"], message: "Justifique o ajuste (mínimo de 10 caracteres)." });
      }
    }
    if (entry.settleNow && !entry.accountId) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Informe a conta do pagamento/recebimento." });
    }
    if (entry.settleNow && entry.isForecast) {
      ctx.addIssue({ code: "custom", path: ["isForecast"], message: "Uma previsão não pode estar paga." });
    }
    if (entry.installments > 1 && entry.settleNow) {
      ctx.addIssue({ code: "custom", path: ["installments"], message: "Parcelas são registradas em aberto." });
    }
  });

export type FinEntryFormValues = z.input<typeof finEntrySchema>;
export type FinEntryInput = z.output<typeof finEntrySchema>;

export const finSettlementSchema = z.object({
  accountId: z.string().uuid("Escolha a conta."),
  settledOn: dateSchema,
  amount: positiveMoney,
  paymentMethod: z.enum(FIN_PAYMENT_METHODS).nullable().optional().or(z.literal("")),
  notes: optionalText(500),
});
export type FinSettlementValues = z.input<typeof finSettlementSchema>;

export const reasonSchema = z.string().trim().min(10, "Informe o motivo com pelo menos 10 caracteres.").max(500);

export const finAccountSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da conta.").max(80),
  kind: z.enum(FIN_ACCOUNT_KINDS),
  bankName: optionalText(80),
  branch: optionalText(20),
  accountNumber: optionalText(30),
  openingBalance: moneySchema,
  openingDate: dateSchema,
  isActive: z.boolean().default(true),
  notes: optionalText(500),
});
export type FinAccountValues = z.input<typeof finAccountSchema>;

export const finCategorySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  parentId: optionalId,
  nature: z.enum(FIN_NATURES),
  costBehavior: z.enum(["fixed", "variable"]).nullable().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export type FinCategoryValues = z.input<typeof finCategorySchema>;

export const finCounterpartySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  kind: z.enum(FIN_COUNTERPARTY_KINDS),
  documentNumber: optionalText(30),
  email: z.string().trim().email("E-mail inválido.").nullable().optional().or(z.literal("")),
  phone: optionalText(30),
  brokerId: optionalId,
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});
export type FinCounterpartyValues = z.input<typeof finCounterpartySchema>;

export const finCostCenterSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  isActive: z.boolean().default(true),
});
export type FinCostCenterValues = z.input<typeof finCostCenterSchema>;

export const finPropertySchema = z.object({
  label: z.string().trim().min(1, "Identifique o imóvel.").max(120),
  address: optionalText(200),
  ownerCounterpartyId: optionalId,
  adminFeeRate: z.number().min(0).max(100).nullable().optional(),
  isActive: z.boolean().default(true),
  notes: optionalText(500),
});
export type FinPropertyValues = z.input<typeof finPropertySchema>;

export const finRentalCollectionSchema = z
  .object({
    propertyId: optionalId,
    ownerCounterpartyId: optionalId,
    tenantCounterpartyId: optionalId,
    accountId: z.string().uuid("Escolha a conta que recebeu."),
    rentAmount: positiveMoney,
    feeMode: z.enum(["rate", "amount"]),
    adminFeeRate: z.number().min(0).max(100).nullable().optional(),
    adminFeeAmount: moneySchema.nullable().optional(),
    receivedOn: dateSchema,
    transferDueDate: optionalDate,
    reference: optionalText(40),
    paymentMethod: z.enum(FIN_PAYMENT_METHODS).nullable().optional().or(z.literal("")),
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (!value.propertyId && !value.ownerCounterpartyId) {
      ctx.addIssue({ code: "custom", path: ["ownerCounterpartyId"], message: "Escolha o imóvel ou o proprietário." });
    }
    if (value.feeMode === "amount" && value.adminFeeAmount != null && value.adminFeeAmount > value.rentAmount) {
      ctx.addIssue({ code: "custom", path: ["adminFeeAmount"], message: "A taxa não pode ser maior que o aluguel." });
    }
  });
export type FinRentalCollectionValues = z.input<typeof finRentalCollectionSchema>;

export const finCommissionReceiptSchema = z.object({
  commissionEntryId: z.string().uuid(),
  accountId: z.string().uuid("Escolha a conta que recebeu."),
  receivedOn: dateSchema,
  brokerDueDate: optionalDate,
});
export type FinCommissionReceiptValues = z.input<typeof finCommissionReceiptSchema>;
