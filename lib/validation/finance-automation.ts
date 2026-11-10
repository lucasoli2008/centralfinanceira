import { z } from "zod";

/** Validação da Fase 2 (extrato, conciliação, regras, recorrências). O banco valida de novo. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const uuid = z.string().uuid("Seleção inválida.");
const optionalUuid = z.union([z.literal(""), uuid]).optional().nullable();
const money = z.number({ error: "Informe um valor." }).finite();

export const statementLineSchema = z.object({
  externalId: z.string().min(1).max(200),
  postedOn: isoDate,
  amount: money.refine((value) => Math.round(value * 100) !== 0, "Valor zerado."),
  description: z.string().max(300),
  memo: z.string().max(300).nullable(),
  documentNumber: z.string().max(100).nullable(),
});

export const statementImportSchema = z.object({
  accountId: uuid,
  fileName: z.string().min(1).max(200),
  format: z.enum(["ofx", "csv"]),
  balance: money.nullable(),
  balanceDate: isoDate.nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  lines: z
    .array(statementLineSchema)
    .min(1, "O arquivo não tem transações.")
    .max(5000, "Importe no máximo 5.000 transações por arquivo."),
});
export type StatementImportValues = z.infer<typeof statementImportSchema>;

export const createFromLineSchema = z
  .object({
    kind: z.enum(["income", "expense", "transfer"]),
    description: z.string().trim().max(300).optional(),
    categoryId: optionalUuid,
    counterpartyId: optionalUuid,
    costCenterId: optionalUuid,
    otherAccountId: optionalUuid,
    ruleId: optionalUuid,
    notes: z.string().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "transfer" && !value.otherAccountId) {
      ctx.addIssue({ code: "custom", path: ["otherAccountId"], message: "Escolha a outra conta da transferência." });
    }
    if (value.kind !== "transfer" && !value.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Selecione uma categoria." });
    }
  });
export type CreateFromLineValues = z.infer<typeof createFromLineSchema>;

export const FIN_RULE_DIRECTIONS = ["any", "income", "expense"] as const;
export const FIN_RULE_MODES = ["contains", "starts_with", "equals"] as const;
export const FIN_RECURRENCE_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

export const finRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome à regra.").max(120),
    isActive: z.boolean(),
    priority: z.number().int().min(0).max(9999),
    matchDirection: z.enum(FIN_RULE_DIRECTIONS),
    matchMode: z.enum(FIN_RULE_MODES),
    matchText: z.string().trim().min(2, "Informe o texto a procurar (ao menos 2 caracteres).").max(200),
    matchAccountId: optionalUuid,
    amountMin: z.number().min(0).nullable(),
    amountMax: z.number().min(0).nullable(),
    categoryId: uuid,
    counterpartyId: optionalUuid,
    costCenterId: optionalUuid,
    descriptionTemplate: z.string().trim().max(300).optional().nullable(),
  })
  .refine((value) => value.amountMin === null || value.amountMax === null || value.amountMin <= value.amountMax, {
    path: ["amountMax"],
    message: "O valor mínimo não pode ser maior que o máximo.",
  });
export type FinRuleValues = z.infer<typeof finRuleSchema>;

export const finRecurrenceSchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    description: z.string().trim().min(1, "Informe a descrição.").max(300),
    amount: money.positive("Informe um valor maior que zero."),
    categoryId: uuid,
    accountId: optionalUuid,
    counterpartyId: optionalUuid,
    costCenterId: optionalUuid,
    propertyId: optionalUuid,
    paymentMethod: z.string().optional().nullable(),
    frequency: z.enum(FIN_RECURRENCE_FREQUENCIES),
    startDate: isoDate,
    endDate: z.union([z.literal(""), isoDate]).optional().nullable(),
    isActive: z.boolean(),
    notes: z.string().max(1000).optional().nullable(),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "A data final deve ser depois da primeira ocorrência.",
  });
export type FinRecurrenceValues = z.infer<typeof finRecurrenceSchema>;
