/**
 * Rótulos em português brasileiro para os enums internos.
 * Nenhuma tela deve escrever esses textos manualmente.
 */

import type { AmountMode, ClosingStatus, EntryType, MemberRole, PropertyType } from "@/lib/finance/types";
import type {
  WorkActivityAction,
  WorkAttachmentCategory,
  WorkCategory,
  WorkEntryType,
  WorkEntryUnit,
  WorkPriority,
  WorkStatus,
} from "@/types/database";

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

// -----------------------------------------------------------------------------
// Obras
// -----------------------------------------------------------------------------

export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  planejada: "Planejada",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  aguardando_material: "Aguardando material",
  aguardando_prestador: "Aguardando prestador",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const WORK_STATUS_TONES: Record<WorkStatus, "neutral" | "accent" | "positive" | "warning" | "danger"> = {
  planejada: "neutral",
  em_andamento: "accent",
  pausada: "warning",
  aguardando_material: "warning",
  aguardando_prestador: "warning",
  concluida: "positive",
  cancelada: "danger",
};

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  manutencao: "Manutenção",
  reforma: "Reforma",
  reparo_hidraulico: "Reparo hidráulico",
  reparo_eletrico: "Reparo elétrico",
  pintura: "Pintura",
  alvenaria: "Alvenaria",
  telhado: "Telhado",
  limpeza: "Limpeza",
  jardinagem: "Jardinagem",
  mobiliario: "Mobiliário",
  manutencao_preventiva: "Manutenção preventiva",
  outros: "Outros",
};

export const WORK_PRIORITY_LABELS: Record<WorkPriority, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

export const WORK_ENTRY_TYPE_LABELS: Record<WorkEntryType, string> = {
  material: "Material",
  servico: "Serviço",
  outro_custo: "Outro custo",
};

export const WORK_ENTRY_UNIT_LABELS: Record<WorkEntryUnit, string> = {
  unidade: "Unidade",
  metro: "Metro",
  m2: "Metro quadrado",
  m3: "Metro cúbico",
  litro: "Litro",
  quilo: "Quilo",
  pacote: "Pacote",
  caixa: "Caixa",
  diaria: "Diária",
  servico: "Serviço",
};

export const WORK_ATTACHMENT_CATEGORY_LABELS: Record<WorkAttachmentCategory, string> = {
  nota_fiscal: "Nota fiscal",
  recibo: "Recibo",
  orcamento: "Orçamento",
  comprovante: "Comprovante",
  foto_antes: "Foto — antes",
  foto_durante: "Foto — durante",
  foto_depois: "Foto — depois",
  outro_documento: "Outro documento",
};

export const WORK_ACTIVITY_ACTION_LABELS: Record<WorkActivityAction, string> = {
  obra_criada: "Obra criada",
  status_alterado: "Status alterado",
  item_adicionado: "Item adicionado",
  item_removido: "Item removido",
  documento_enviado: "Documento enviado",
  foto_adicionada: "Foto adicionada",
  obra_concluida: "Obra concluída",
  obra_arquivada: "Obra arquivada",
};
