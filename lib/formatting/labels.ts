/**
 * Rótulos em português brasileiro para os enums internos.
 * Nenhuma tela deve escrever esses textos manualmente.
 */

import type { AmountMode, ClosingStatus, EntryType, MemberRole, PropertyType } from "@/lib/finance/types";
import type {
  FinAccountKind,
  FinanceRole,
  FinCounterpartyKind,
  FinEntryKind,
  FinEntryOrigin,
  FinEntryStatus,
  FinNature,
  FinOperationKind,
  FinPaymentMethod,
  FinRegime,
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
  item_editado: "Item editado",
  item_removido: "Item removido",
  item_pago: "Pagamento registrado",
  documento_enviado: "Documento enviado",
  foto_adicionada: "Foto adicionada",
  anexo_removido: "Anexo removido",
  obra_concluida: "Obra concluída",
  obra_arquivada: "Obra arquivada",
  obra_reaberta: "Obra reaberta",
};

// -----------------------------------------------------------------------------
// Controle Financeiro
// -----------------------------------------------------------------------------

export const FINANCE_ROLE_LABELS: Record<FinanceRole, string> = {
  admin: "Administrador",
  financeiro: "Financeiro",
  gestor: "Gestor",
  consulta: "Consulta",
  sem_acesso: "Sem acesso",
};

export const FINANCE_ROLE_DESCRIPTIONS: Record<FinanceRole, string> = {
  admin: "Tudo, inclusive reabrir períodos e definir permissões.",
  financeiro: "Lança, baixa, cadastra, importa e concilia.",
  gestor: "Vê tudo, exporta relatórios e aprova o fechamento.",
  consulta: "Somente leitura de painéis e relatórios.",
  sem_acesso: "Não vê o Controle Financeiro.",
};

export const FIN_ACCOUNT_KIND_LABELS: Record<FinAccountKind, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Caixa (dinheiro)",
  digital: "Conta digital / pagamentos",
  investment: "Aplicação",
};

export const FIN_NATURE_LABELS: Record<FinNature, string> = {
  own_revenue: "Receita própria",
  other_revenue: "Outras receitas",
  deduction: "Dedução da receita",
  direct_cost: "Custo direto",
  operating_expense: "Despesa operacional",
  other_expense: "Outras despesas",
  third_party: "Valor de terceiros",
  deposit: "Caução / depósito",
  equity: "Sócios",
};

/** Explica, na interface, o efeito contábil de cada natureza. */
export const FIN_NATURE_HINTS: Record<FinNature, string> = {
  own_revenue: "Entra no resultado como receita da imobiliária.",
  other_revenue: "Receita não operacional (rendimentos, diversas).",
  deduction: "Reduz a receita (impostos sobre faturamento).",
  direct_cost: "Custo ligado diretamente às operações.",
  operating_expense: "Despesa do dia a dia da imobiliária.",
  other_expense: "Juros, multas e despesas não operacionais.",
  third_party: "Dinheiro de terceiros: não é receita nem despesa, é obrigação.",
  deposit: "Caução reembolsável: fica como obrigação até a devolução.",
  equity: "Aporte ou retirada de sócios: não entra no resultado operacional.",
};

export const FIN_COUNTERPARTY_KIND_LABELS: Record<FinCounterpartyKind, string> = {
  supplier: "Fornecedor",
  client: "Cliente",
  owner: "Proprietário",
  tenant: "Inquilino",
  broker: "Corretor",
  partner: "Sócio",
  government: "Órgão público",
  bank: "Banco",
  other: "Outro",
  employee: "Funcionário",
};

export const FIN_ENTRY_KIND_LABELS: Record<FinEntryKind, string> = {
  income: "Entrada",
  expense: "Saída",
  transfer: "Transferência",
  adjustment: "Ajuste de saldo",
};

export const FIN_ENTRY_STATUS_LABELS: Record<FinEntryStatus, string> = {
  forecast: "Previsto",
  open: "Em aberto",
  partial: "Parcial",
  settled: "Liquidado",
  cancelled: "Cancelado",
};

export const FIN_ENTRY_STATUS_TONES: Record<FinEntryStatus, "neutral" | "accent" | "positive" | "warning" | "danger" | "info"> = {
  forecast: "info",
  open: "neutral",
  partial: "warning",
  settled: "positive",
  cancelled: "neutral",
};

export const FIN_PAYMENT_METHOD_LABELS: Record<FinPaymentMethod, string> = {
  pix: "Pix",
  ted: "TED / transferência",
  boleto: "Boleto",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  debito_automatico: "Débito automático",
  outro: "Outro",
};

export const FIN_ORIGIN_LABELS: Record<FinEntryOrigin, string> = {
  manual: "Manual",
  opening_balance: "Saldo inicial",
  commission: "Comissão",
  rental: "Aluguel",
  recurrence: "Recorrência",
  import: "Importação",
};

export const FIN_OPERATION_KIND_LABELS: Record<FinOperationKind, string> = {
  rental_collection: "Recebimento de aluguel",
  commission_receipt: "Recebimento de comissão",
};

export const FIN_REGIME_LABELS: Record<FinRegime, string> = {
  caixa: "Caixa",
  competencia: "Competência",
};
