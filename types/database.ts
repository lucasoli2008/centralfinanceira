/**
 * Tipos do banco de dados.
 *
 * Mantidos manualmente e espelhando supabase/migrations. Para regenerar a
 * partir de um projeto Supabase real:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public > types/database.ts
 *
 * Qualquer alteração de schema exige atualizar este arquivo (ver CLAUDE.md).
 */

import type {
  AmountMode,
  ClosingStatus,
  EntryType,
  MemberRole,
  PropertyType,
} from "@/lib/finance/types";

export type MemberStatus = "active" | "inactive";

export interface OrganizationRow {
  id: string;
  name: string;
  legal_name: string | null;
  document_number: string | null;
  logo_url: string | null;
  accent_color: string;
  timezone: string;
  currency: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  created_at: string;
  updated_at: string;
}

export interface BrokerRow {
  id: string;
  organization_id: string;
  full_name: string;
  short_name: string | null;
  email: string | null;
  phone: string | null;
  document_number: string | null;
  default_split_mode: AmountMode;
  default_split_rate: number | null;
  default_split_fixed_amount: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface FinancialEntryRow {
  id: string;
  organization_id: string;
  entry_type: EntryType;
  entry_date: string;
  description: string;
  reference: string | null;
  property_type: PropertyType;
  base_amount: number;
  commission_mode: AmountMode;
  commission_rate: number | null;
  commission_fixed_amount: number | null;
  notes: string | null;
  exception_confirmed: boolean;
  exception_reason: string | null;
  import_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
  entry_year: number;
  entry_month: number;
}

export interface EntryBrokerSplitRow {
  id: string;
  organization_id: string;
  entry_id: string;
  broker_id: string;
  split_mode: AmountMode;
  split_rate: number | null;
  split_fixed_amount: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface OrganizationSettingsRow {
  id: string;
  organization_id: string;
  default_sale_commission_mode: AmountMode;
  default_sale_commission_rate: number;
  default_sale_commission_fixed_amount: number | null;
  default_rental_commission_mode: AmountMode;
  default_rental_commission_rate: number;
  default_rental_commission_fixed_amount: number | null;
  default_broker_split_rate: number;
  monthly_closing_enabled: boolean;
  report_header: string | null;
  report_footer: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyClosingRow {
  id: string;
  organization_id: string;
  year: number;
  month: number;
  status: ClosingStatus;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: number;
  organization_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EntryImportRow {
  id: string;
  organization_id: string;
  source_filename: string | null;
  entries_count: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  undone_at: string | null;
  undone_by: string | null;
}

/** View financial_entry_totals — totais calculados por lançamento. */
export interface EntryTotalsRow {
  entry_id: string;
  organization_id: string;
  entry_type: EntryType;
  entry_date: string;
  year: number;
  month: number;
  period_key: string;
  description: string;
  reference: string | null;
  property_type: PropertyType;
  base_amount: number;
  commission_mode: AmountMode;
  commission_rate: number | null;
  commission_fixed_amount: number | null;
  gross_commission: number;
  total_broker_payout: number;
  net_company_revenue: number;
  net_margin: number | null;
  broker_count: number;
  broker_names: string[] | null;
  broker_ids: string[] | null;
  notes: string | null;
  exception_confirmed: boolean;
  exception_reason: string | null;
  import_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deletion_reason: string | null;
}

/** View entry_split_amounts — repasses com valor calculado. */
export interface SplitAmountRow {
  split_id: string;
  organization_id: string;
  entry_id: string;
  broker_id: string;
  broker_name: string;
  broker_short_name: string | null;
  broker_is_active: boolean;
  split_mode: AmountMode;
  split_rate: number | null;
  split_fixed_amount: number | null;
  payout_amount: number;
  entry_type: EntryType;
  entry_date: string;
  base_amount: number;
  entry_deleted_at: string | null;
  deleted_at: string | null;
}

/** Retorno de report_summary. */
export interface SummaryRow {
  total_gross_commission: number;
  total_broker_payout: number;
  total_net_revenue: number;
  entries_count: number;
  sales_count: number;
  rental_count: number;
  sales_base_amount: number;
  sales_gross_commission: number;
  sales_net_revenue: number;
  rental_base_amount: number;
  rental_gross_commission: number;
  rental_net_revenue: number;
  average_gross_commission: number | null;
  net_margin: number | null;
  weighted_sale_commission_rate: number | null;
  average_broker_payout_rate: number | null;
}

/** Retorno de report_monthly_series. */
export interface MonthlySeriesRow {
  year: number;
  month: number;
  period_key: string;
  total_gross_commission: number;
  total_broker_payout: number;
  total_net_revenue: number;
  sales_gross_commission: number;
  rental_gross_commission: number;
  sales_base_amount: number;
  rental_base_amount: number;
  entries_count: number;
  sales_count: number;
  rental_count: number;
}

/** Retorno de report_broker_ranking. */
export interface BrokerRankingRow {
  broker_id: string;
  broker_name: string;
  broker_is_active: boolean;
  participations: number;
  total_payout: number;
  average_payout: number;
  participated_base_amount: number;
  participated_gross_commission: number;
  last_participation: string | null;
}

/** Retorno de report_broker_statement. */
export interface BrokerStatementRow {
  entry_id: string;
  entry_date: string;
  entry_type: EntryType;
  description: string;
  reference: string | null;
  base_amount: number;
  gross_commission: number;
  split_mode: AmountMode;
  split_rate: number | null;
  split_fixed_amount: number | null;
  payout_amount: number;
}

// -----------------------------------------------------------------------------
// Obras — controle de reformas e manutenções (supabase/migrations/0008_works.sql)
// -----------------------------------------------------------------------------

export type WorkStatus =
  | "planejada"
  | "em_andamento"
  | "pausada"
  | "aguardando_material"
  | "aguardando_prestador"
  | "concluida"
  | "cancelada";

export type WorkCategory =
  | "manutencao"
  | "reforma"
  | "reparo_hidraulico"
  | "reparo_eletrico"
  | "pintura"
  | "alvenaria"
  | "telhado"
  | "limpeza"
  | "jardinagem"
  | "mobiliario"
  | "manutencao_preventiva"
  | "outros";

export type WorkPriority = "baixa" | "normal" | "alta" | "urgente";

export type WorkEntryType = "material" | "servico" | "outro_custo";

export type WorkEntryUnit =
  | "unidade"
  | "metro"
  | "m2"
  | "m3"
  | "litro"
  | "quilo"
  | "pacote"
  | "caixa"
  | "diaria"
  | "servico";

export type WorkAttachmentCategory =
  | "nota_fiscal"
  | "recibo"
  | "orcamento"
  | "comprovante"
  | "foto_antes"
  | "foto_durante"
  | "foto_depois"
  | "outro_documento";

export type WorkActivityAction =
  | "obra_criada"
  | "status_alterado"
  | "item_adicionado"
  | "item_removido"
  | "documento_enviado"
  | "foto_adicionada"
  | "obra_concluida"
  | "obra_arquivada";

export interface WorkRow {
  id: string;
  organization_id: string;
  code: string;
  title: string;
  property_label: string;
  address: string;
  owner_label: string;
  responsible_name: string;
  description: string;
  status: WorkStatus;
  category: WorkCategory;
  priority: WorkPriority;
  requested_at: string | null;
  started_at: string | null;
  expected_at: string | null;
  completed_at: string | null;
  notes: string | null;
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkEntryRow {
  id: string;
  organization_id: string;
  work_id: string;
  entry_type: WorkEntryType;
  entry_date: string;
  description: string;
  category: string | null;
  supplier_name: string | null;
  quantity: number;
  unit: WorkEntryUnit;
  unit_price: number;
  total_amount: number;
  total_is_manual: boolean;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WorkAttachmentRow {
  id: string;
  organization_id: string;
  work_id: string;
  work_entry_id: string | null;
  category: WorkAttachmentCategory;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface WorkActivityRow {
  id: string;
  organization_id: string;
  work_id: string;
  action: WorkActivityAction;
  description: string;
  created_by: string | null;
  created_at: string;
}
