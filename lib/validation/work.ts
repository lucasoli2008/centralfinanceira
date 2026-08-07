/**
 * Validação do módulo de Obras — usada no cliente (React Hook Form) e no
 * servidor (Server Actions). O banco repete as regras críticas em
 * app_save_work/app_save_work_entry (ver supabase/migrations/0008_works.sql).
 */

import { z } from "zod";
import { hasValidMoneyPrecision } from "@/lib/formatting/number";

const moneySchema = z
  .number({ message: "Informe um valor válido." })
  .finite("Informe um valor válido.")
  .min(0, "O valor não pode ser negativo.")
  .refine(hasValidMoneyPrecision, "Use no máximo duas casas decimais.");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Data inválida.");

export const WORK_STATUSES = [
  "planejada",
  "em_andamento",
  "pausada",
  "aguardando_material",
  "aguardando_prestador",
  "concluida",
  "cancelada",
] as const;

export const WORK_CATEGORIES = [
  "manutencao",
  "reforma",
  "reparo_hidraulico",
  "reparo_eletrico",
  "pintura",
  "alvenaria",
  "telhado",
  "limpeza",
  "jardinagem",
  "mobiliario",
  "manutencao_preventiva",
  "outros",
] as const;

export const WORK_PRIORITIES = ["baixa", "normal", "alta", "urgente"] as const;

export const WORK_ENTRY_TYPES = ["material", "servico", "outro_custo"] as const;

export const WORK_ENTRY_UNITS = [
  "unidade",
  "metro",
  "m2",
  "m3",
  "litro",
  "quilo",
  "pacote",
  "caixa",
  "diaria",
  "servico",
] as const;

export const WORK_ATTACHMENT_CATEGORIES = [
  "nota_fiscal",
  "recibo",
  "orcamento",
  "comprovante",
  "foto_antes",
  "foto_durante",
  "foto_depois",
  "outro_documento",
] as const;

export const workSchema = z
  .object({
    title: z.string().trim().min(1, "Informe o título da obra.").max(160, "Use no máximo 160 caracteres."),
    propertyLabel: z.string().trim().min(1, "Informe o imóvel.").max(160, "Use no máximo 160 caracteres."),
    address: z.string().trim().min(1, "Informe o endereço.").max(240, "Use no máximo 240 caracteres."),
    ownerLabel: z.string().trim().min(1, "Informe o proprietário.").max(160, "Use no máximo 160 caracteres."),
    responsibleName: z
      .string()
      .trim()
      .min(1, "Informe o responsável interno.")
      .max(120, "Use no máximo 120 caracteres."),
    description: z.string().trim().min(1, "Descreva a obra.").max(2000, "Use no máximo 2000 caracteres."),
    status: z.enum(WORK_STATUSES, { message: "Selecione o status." }),
    category: z.enum(WORK_CATEGORIES, { message: "Selecione a categoria." }),
    priority: z.enum(WORK_PRIORITIES, { message: "Selecione a prioridade." }),
    requestedAt: dateSchema.nullable().optional(),
    startedAt: dateSchema.nullable().optional(),
    expectedAt: dateSchema.nullable().optional(),
    completedAt: dateSchema.nullable().optional(),
    notes: z.string().trim().max(2000, "Use no máximo 2000 caracteres.").nullable().optional(),
  })
  .superRefine((work, ctx) => {
    if (work.completedAt && work.startedAt && work.completedAt < work.startedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "A data de conclusão não pode ser anterior à data de início.",
      });
    }
  });

export type WorkFormValues = z.input<typeof workSchema>;
export type WorkInput = z.output<typeof workSchema>;

export const workEntrySchema = z.object({
  workId: z.uuid("Obra inválida."),
  entryType: z.enum(WORK_ENTRY_TYPES, { message: "Selecione o tipo do lançamento." }),
  entryDate: dateSchema,
  description: z.string().trim().min(1, "Descreva o item.").max(200, "Use no máximo 200 caracteres."),
  category: z.string().trim().max(60, "Use no máximo 60 caracteres.").nullable().optional(),
  supplierName: z.string().trim().max(120, "Use no máximo 120 caracteres.").nullable().optional(),
  quantity: z
    .number({ message: "Informe a quantidade." })
    .finite("Informe a quantidade.")
    .positive("A quantidade deve ser maior que zero."),
  unit: z.enum(WORK_ENTRY_UNITS, { message: "Selecione a unidade." }),
  unitPrice: moneySchema,
  totalAmount: moneySchema,
  totalIsManual: z.boolean().default(false),
  notes: z.string().trim().max(2000, "Use no máximo 2000 caracteres.").nullable().optional(),
});

export type WorkEntryFormValues = z.input<typeof workEntrySchema>;
export type WorkEntryInput = z.output<typeof workEntrySchema>;

export const archiveWorkSchema = z.object({
  reason: z.string().trim().max(500, "Use no máximo 500 caracteres.").nullable().optional(),
});

export const workAttachmentSchema = z.object({
  workId: z.uuid("Obra inválida."),
  workEntryId: z.uuid().nullable().optional(),
  category: z.enum(WORK_ATTACHMENT_CATEGORIES, { message: "Selecione a categoria do anexo." }),
  description: z.string().trim().max(200, "Use no máximo 200 caracteres.").nullable().optional(),
});
