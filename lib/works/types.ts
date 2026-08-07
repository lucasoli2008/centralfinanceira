/**
 * Tipos do domínio de Obras.
 *
 * Enums vivem em `types/database.ts` (mesmo padrão de `lib/finance/types.ts`);
 * este arquivo reexporta para quem só precisa do domínio, sem importar o
 * arquivo de tipos de banco inteiro.
 */

import type { WorkAttachmentRow } from "@/types/database";

export type {
  WorkStatus,
  WorkCategory,
  WorkPriority,
  WorkEntryType,
  WorkEntryUnit,
  WorkAttachmentCategory,
  WorkActivityAction,
} from "@/types/database";

export interface WorkTotals {
  materialsTotal: number;
  servicesTotal: number;
  otherTotal: number;
  grandTotal: number;
}

/** Anexo com a URL assinada já resolvida no servidor (nunca armazenada). */
export interface WorkAttachmentWithUrl extends WorkAttachmentRow {
  url: string | null;
}
