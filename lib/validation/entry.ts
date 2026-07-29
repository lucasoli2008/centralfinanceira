/**
 * Validação de lançamentos — usada no cliente (React Hook Form) e no servidor
 * (Server Actions). O banco repete as regras críticas em app_save_entry.
 */

import { z } from "zod";
import { calculateEntryTotals } from "@/lib/finance/engine";
import { hasValidMoneyPrecision } from "@/lib/formatting/number";

const moneySchema = z
  .number({ message: "Informe um valor válido." })
  .finite("Informe um valor válido.")
  .min(0, "O valor não pode ser negativo.")
  .refine(hasValidMoneyPrecision, "Use no máximo duas casas decimais.");

const rateSchema = z
  .number({ message: "Informe um percentual válido." })
  .finite("Informe um percentual válido.")
  .min(0, "O percentual não pode ser negativo.")
  .max(100, "Informe um percentual entre 0 e 100.");

export const splitSchema = z
  .object({
    brokerId: z.uuid("Selecione o corretor."),
    splitMode: z.enum(["percentage", "fixed"]),
    splitRate: rateSchema.nullable().optional(),
    splitFixedAmount: moneySchema.nullable().optional(),
  })
  .superRefine((split, ctx) => {
    if (split.splitMode === "percentage" && (split.splitRate === null || split.splitRate === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["splitRate"],
        message: "Informe o percentual do repasse.",
      });
    }
    if (
      split.splitMode === "fixed" &&
      (split.splitFixedAmount === null || split.splitFixedAmount === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["splitFixedAmount"],
        message: "Informe o valor do repasse.",
      });
    }
  });

export const entrySchema = z
  .object({
    entryType: z.enum(["sale", "rental"], { message: "Selecione o tipo de entrada." }),
    entryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da entrada.")
      .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Data inválida."),
    description: z
      .string()
      .trim()
      .min(1, "Informe uma descrição.")
      .max(200, "Use no máximo 200 caracteres."),
    reference: z.string().trim().max(80, "Use no máximo 80 caracteres.").nullable().optional(),
    propertyType: z.enum(["residential", "commercial"]),
    baseAmount: moneySchema,
    commissionMode: z.enum(["percentage", "fixed"]),
    commissionRate: rateSchema.nullable().optional(),
    commissionFixedAmount: moneySchema.nullable().optional(),
    notes: z.string().trim().max(2000, "Use no máximo 2000 caracteres.").nullable().optional(),
    splits: z.array(splitSchema).default([]),
    exceptionConfirmed: z.boolean().default(false),
    exceptionReason: z.string().trim().nullable().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.baseAmount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["baseAmount"],
        message:
          entry.entryType === "sale"
            ? "Informe o valor da venda."
            : "Informe o valor do primeiro aluguel.",
      });
    }

    if (
      entry.commissionMode === "percentage" &&
      (entry.commissionRate === null || entry.commissionRate === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["commissionRate"],
        message: "Informe o percentual da comissão.",
      });
    }

    if (
      entry.commissionMode === "fixed" &&
      (entry.commissionFixedAmount === null || entry.commissionFixedAmount === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["commissionFixedAmount"],
        message: "Informe o valor fixo da comissão.",
      });
    }

    const brokerIds = entry.splits.map((split) => split.brokerId);
    brokerIds.forEach((brokerId, index) => {
      if (brokerIds.indexOf(brokerId) !== index) {
        ctx.addIssue({
          code: "custom",
          path: ["splits", index, "brokerId"],
          message: "Este corretor já foi adicionado ao lançamento.",
        });
      }
    });

    const totals = calculateEntryTotals(
      {
        mode: entry.commissionMode,
        baseAmount: entry.baseAmount,
        rate: entry.commissionRate,
        fixedAmount: entry.commissionFixedAmount,
      },
      entry.splits.map((split) => ({
        brokerId: split.brokerId,
        mode: split.splitMode,
        rate: split.splitRate,
        fixedAmount: split.splitFixedAmount,
      })),
    );

    if (totals.isNegativeNet) {
      if (!entry.exceptionConfirmed) {
        ctx.addIssue({
          code: "custom",
          path: ["exceptionConfirmed"],
          message:
            "A soma dos repasses aos corretores é maior que a comissão bruta. Isso fará com que a receita líquida da imobiliária fique negativa.",
        });
      } else if (!entry.exceptionReason || entry.exceptionReason.trim().length < 10) {
        ctx.addIssue({
          code: "custom",
          path: ["exceptionReason"],
          message: "Descreva a justificativa com pelo menos 10 caracteres.",
        });
      }
    }
  });

export type EntryFormValues = z.input<typeof entrySchema>;
export type EntryInput = z.output<typeof entrySchema>;

export const brokerSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome do corretor.").max(120, "Use no máximo 120 caracteres."),
  shortName: z.string().trim().max(40, "Use no máximo 40 caracteres.").nullable().optional(),
  email: z.union([z.email("Informe um e-mail válido."), z.literal("")]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  documentNumber: z.string().trim().max(40).nullable().optional(),
  defaultSplitMode: z.enum(["percentage", "fixed"]).default("percentage"),
  defaultSplitRate: rateSchema.nullable().optional(),
  defaultSplitFixedAmount: moneySchema.nullable().optional(),
  isActive: z.boolean().default(true),
  confirmDuplicateName: z.boolean().default(false),
});

export type BrokerInput = z.output<typeof brokerSchema>;

export const settingsSchema = z.object({
  defaultSaleCommissionMode: z.enum(["percentage", "fixed"]),
  defaultSaleCommissionRate: rateSchema,
  defaultSaleCommissionFixedAmount: moneySchema.nullable().optional(),
  defaultRentalCommissionMode: z.enum(["percentage", "fixed"]),
  defaultRentalCommissionRate: rateSchema,
  defaultRentalCommissionFixedAmount: moneySchema.nullable().optional(),
  defaultBrokerSplitRate: rateSchema,
  monthlyClosingEnabled: z.boolean(),
  reportHeader: z.string().trim().max(200).nullable().optional(),
  reportFooter: z.string().trim().max(200).nullable().optional(),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome exibido.").max(120),
  legalName: z.string().trim().max(160).nullable().optional(),
  documentNumber: z.string().trim().max(40).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Informe uma cor no formato #RRGGBB."),
  logoUrl: z.union([z.url("Informe uma URL válida."), z.literal("")]).nullable().optional(),
});

export const closeMonthSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12),
});

export const reopenMonthSchema = closeMonthSchema.extend({
  reason: z.string().trim().min(10, "Descreva a justificativa com pelo menos 10 caracteres."),
});
