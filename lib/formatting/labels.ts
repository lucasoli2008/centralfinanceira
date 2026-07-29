/**
 * Rótulos em português brasileiro para os enums internos.
 * Nenhuma tela deve escrever esses textos manualmente.
 */

import type { AmountMode, ClosingStatus, EntryType, MemberRole, PropertyType } from "@/lib/finance/types";

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  sale: "Venda",
  rental: "Locação",
};

export const ENTRY_TYPE_PLURAL_LABELS: Record<EntryType, string> = {
  sale: "Vendas",
  rental: "Locações",
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  residential: "Residencial",
  commercial: "Comercial",
};

export const AMOUNT_MODE_LABELS: Record<AmountMode, string> = {
  percentage: "Percentual",
  fixed: "Valor fixo",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
};

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  open: "Aberto",
  closed: "Fechado",
};

/** Rótulo do valor-base conforme o tipo de lançamento. */
export function baseAmountLabel(entryType: EntryType): string {
  return entryType === "sale" ? "Valor da venda" : "Valor do primeiro aluguel";
}

export function baseAmountShortLabel(entryType: EntryType): string {
  return entryType === "sale" ? "Valor da venda" : "Primeiro aluguel";
}

/** Ações registradas na auditoria. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  restore: "Restauração",
  hard_delete: "Exclusão definitiva",
  financial_exception_confirmed: "Exceção financeira confirmada",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  financial_entries: "Lançamento",
  entry_broker_splits: "Repasse",
  brokers: "Corretor",
  organizations: "Organização",
  organization_settings: "Configurações",
  organization_members: "Usuário",
  monthly_closings: "Fechamento mensal",
  entry_imports: "Importação",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditEntityLabel(entity: string): string {
  return AUDIT_ENTITY_LABELS[entity] ?? entity;
}
