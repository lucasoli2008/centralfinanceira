import { z } from "zod";

/** Lançamento rápido do Controle Financeiro (0013). O banco valida de novo. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");
const optionalUuid = z.union([z.literal(""), z.string().uuid()]).optional().nullable();

export const quickEntrySchema = z
  .object({
    kind: z.enum(["income", "expense"]),
    description: z.string().trim().min(1, "Informe a descrição.").max(300),
    amount: z.number({ error: "Informe o valor." }).positive("Informe um valor maior que zero."),
    categoryId: z.string().uuid("Escolha a categoria."),
    date: isoDate,
    paid: z.boolean(),
    paidOn: z.union([z.literal(""), isoDate]).optional().nullable(),
    accountId: optionalUuid,
    counterpartyId: optionalUuid,
    costCenterId: optionalUuid,
    propertyId: optionalUuid,
    recurring: z.enum(["none", "fixed", "variable"]),
    notes: z.string().max(1000).optional().nullable(),
  })
  .refine((value) => !value.paid || Boolean(value.accountId), { path: ["accountId"], message: "Escolha a conta do pagamento." });
export type QuickEntryValues = z.infer<typeof quickEntrySchema>;

