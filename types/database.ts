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
  | "item_editado"
  | "item_removido"
  | "item_pago"
  | "documento_enviado"
  | "foto_adicionada"
  | "anexo_removido"
  | "obra_concluida"
  | "obra_arquivada"
  | "obra_reaberta";

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
  is_paid: boolean;
  paid_at: string | null;
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

// -----------------------------------------------------------------------------
// Controle Financeiro (0010_finance_core.sql)
// -----------------------------------------------------------------------------

export type FinanceRole = "admin" | "financeiro" | "gestor" | "consulta" | "sem_acesso";
export type FinAccountKind = "checking" | "savings" | "cash" | "digital" | "investment";
export type FinNature =
  | "own_revenue"
  | "other_revenue"
  | "deduction"
  | "direct_cost"
  | "operating_expense"
  | "other_expense"
  | "third_party"
  | "deposit"
  | "equity";
export type FinCostBehavior = "fixed" | "variable";
export type FinCounterpartyKind =
  | "supplier"
  | "client"
  | "owner"
  | "tenant"
  | "broker"
  | "partner"
  | "government"
  | "bank"
  | "other"
  | "employee";
export type FinEntryKind = "income" | "expense" | "transfer" | "adjustment";
export type FinEntryStatus = "forecast" | "open" | "partial" | "settled" | "cancelled";
export type FinPaymentMethod =
  | "pix"
  | "ted"
  | "boleto"
  | "cartao_credito"
  | "cartao_debito"
  | "dinheiro"
  | "cheque"
  | "debito_automatico"
  | "outro";
export type FinEntryOrigin = "manual" | "opening_balance" | "commission" | "rental" | "recurrence" | "import";
export type FinOperationKind = "rental_collection" | "commission_receipt";
export type FinRegime = "caixa" | "competencia";

export interface FinAccountRow {
  id: string;
  organization_id: string;
  name: string;
  kind: FinAccountKind;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  opening_balance: number;
  opening_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinCategoryRow {
  id: string;
  organization_id: string;
  parent_id: string | null;
  name: string;
  nature: FinNature;
  cost_behavior: FinCostBehavior | null;
  system_key: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface FinCostCenterRow {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
}

export interface FinCounterpartyRow {
  id: string;
  organization_id: string;
  name: string;
  kind: FinCounterpartyKind;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  broker_id: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface FinPropertyRow {
  id: string;
  organization_id: string;
  label: string;
  address: string | null;
  owner_counterparty_id: string | null;
  admin_fee_rate: number | null;
  is_active: boolean;
  notes: string | null;
}

export interface FinOperationRow {
  id: string;
  organization_id: string;
  kind: FinOperationKind;
  description: string;
  property_id: string | null;
  counterparty_id: string | null;
  commission_entry_id: string | null;
  reference_date: string;
  gross_amount: number;
  own_amount: number;
  third_party_amount: number;
  notes: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface FinEntryDetailRow {
  id: string;
  organization_id: string;
  kind: FinEntryKind;
  description: string;
  amount: number;
  settled_amount: number;
  remaining_amount: number;
  status: FinEntryStatus;
  is_forecast: boolean;
  category_id: string | null;
  category_name: string | null;
  nature: FinNature | null;
  category_parent_id: string | null;
  category_parent_name: string | null;
  account_id: string | null;
  account_name: string | null;
  transfer_account_id: string | null;
  transfer_account_name: string | null;
  adjustment_direction: "increase" | "decrease" | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  property_id: string | null;
  property_label: string | null;
  operation_id: string | null;
  operation_kind: FinOperationKind | null;
  payment_method: FinPaymentMethod | null;
  competence_date: string;
  due_date: string | null;
  reference_date: string;
  last_settled_on: string | null;
  is_overdue: boolean;
  document_number: string | null;
  notes: string | null;
  origin: FinEntryOrigin;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_count: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  attachments_count: number;
}

export interface FinSettlementRow {
  id: string;
  organization_id: string;
  entry_id: string;
  account_id: string;
  settled_on: string;
  amount: number;
  payment_method: FinPaymentMethod | null;
  notes: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FinAttachmentRow {
  id: string;
  organization_id: string;
  entry_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface FinSummaryRow {
  cash_balance: number;
  cash_in: number;
  cash_out: number;
  own_revenue: number;
  other_revenue: number;
  deductions: number;
  direct_costs: number;
  operating_expenses: number;
  other_expenses: number;
  net_result: number;
  partner_withdrawals: number;
  receivables_open: number;
  receivables_overdue: number;
  payables_open: number;
  payables_overdue: number;
  third_party_obligations: number;
  deposits_held: number;
  broker_payouts_pending: number;
  commissions_not_in_cash: number;
  commissions_not_in_cash_count: number;
  own_available: number;
  forecast_30_balance: number;
}

export interface FinMonthlyRow {
  period_key: string;
  year: number;
  month: number;
  revenue: number;
  expenses: number;
  result: number;
  cash_in: number;
  cash_out: number;
  closing_balance: number;
  planned_in: number;
  planned_out: number;
}

export interface FinCategoryTotalRow {
  category_id: string;
  category_name: string;
  group_name: string;
  nature: FinNature;
  total: number;
  items_count: number;
}

export interface FinAccountBalanceRow {
  account_id: string;
  name: string;
  kind: FinAccountKind;
  is_active: boolean;
  balance: number;
}

export interface FinPropertyResultRow {
  property_id: string;
  label: string;
  rent_collected: number;
  own_revenue: number;
  owner_transferred: number;
  owner_pending: number;
  direct_expenses: number;
  result: number;
}

// -----------------------------------------------------------------------------
// Controle Financeiro — Fase 2 (conciliação, regras, recorrências)
// -----------------------------------------------------------------------------
export type FinStatementLineStatus = "pending" | "matched" | "ignored";
export type FinRuleDirection = "income" | "expense" | "any";
export type FinRuleMatchMode = "contains" | "starts_with" | "equals";
export type FinRecurrenceFrequency = "monthly" | "quarterly" | "yearly";

export interface FinBankImportRow {
  id: string;
  organization_id: string;
  account_id: string;
  file_name: string;
  file_format: "ofx" | "csv";
  file_hash: string | null;
  period_start: string | null;
  period_end: string | null;
  statement_balance: number | null;
  statement_balance_date: string | null;
  lines_total: number;
  lines_inserted: number;
  lines_duplicated: number;
  created_by: string | null;
  created_at: string;
}

export interface FinStatementLineListRow {
  id: string;
  import_id: string;
  posted_on: string;
  amount: number;
  description: string;
  memo: string | null;
  document_number: string | null;
  status: FinStatementLineStatus;
  ignore_reason: string | null;
  matched_entry_id: string | null;
  matched_settlement_id: string | null;
  matched_description: string | null;
  matched_at: string | null;
  suggested_entry_id: string | null;
  suggested_settlement_id: string | null;
  suggested_description: string | null;
  suggested_day_diff: number | null;
  rule_id: string | null;
  rule_name: string | null;
  rule_category_id: string | null;
  rule_category_name: string | null;
}

export interface FinLineCandidateRow {
  candidate_type: "movement" | "open_entry";
  entry_id: string;
  settlement_id: string | null;
  ref_date: string;
  amount: number;
  remaining: number;
  description: string;
  counterparty_name: string | null;
  day_diff: number;
  exact: boolean;
}

export interface FinReconciliationSummaryRow {
  ledger_balance: number;
  statement_balance: number | null;
  statement_balance_date: string | null;
  ledger_balance_at_statement: number | null;
  difference: number | null;
  pending_lines: number;
  pending_in: number;
  pending_out: number;
  matched_lines: number;
  ignored_lines: number;
  first_line_date: string | null;
  last_line_date: string | null;
  unmatched_movements: number;
  suggestions: number;
  last_import_at: string | null;
}

export interface FinAccountMovementRow {
  entry_id: string;
  settlement_id: string | null;
  movement_date: string;
  signed_amount: number;
  description: string;
  counterparty_name: string | null;
  entry_kind: FinEntryKind;
  matched_line_id: string | null;
}

export interface FinRuleRow {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  priority: number;
  match_direction: FinRuleDirection;
  match_mode: FinRuleMatchMode;
  match_text: string;
  match_account_id: string | null;
  amount_min: number | null;
  amount_max: number | null;
  category_id: string;
  counterparty_id: string | null;
  cost_center_id: string | null;
  description_template: string | null;
  times_applied: number;
  last_applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinRecurrenceRow {
  id: string;
  organization_id: string;
  kind: "income" | "expense";
  description: string;
  amount: number;
  category_id: string;
  account_id: string | null;
  counterparty_id: string | null;
  cost_center_id: string | null;
  property_id: string | null;
  payment_method: FinPaymentMethod | null;
  frequency: FinRecurrenceFrequency;
  start_date: string;
  end_date: string | null;
  forecast_until: string | null;
  value_mode: "fixed" | "variable";
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Controle Financeiro — Fase 3 (DRE, fluxo projetado, fechamento, inteligência)
// -----------------------------------------------------------------------------
export interface FinCashProjectionRow {
  bucket_start: string | null;
  bucket_end: string | null;
  inflow: number;
  outflow: number;
  third_party_out: number;
  forecast_in: number;
  forecast_out: number;
  opening_balance: number;
  closing_balance: number;
}

export interface FinPeriodCloseRow {
  id: string;
  year: number;
  month: number;
  closed_at: string;
  closed_by: string | null;
  notes: string | null;
  snapshot: { caixa?: FinSummaryRow; competencia?: FinSummaryRow } & Record<string, unknown>;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
}

export interface FinCloseCheckRow {
  check_key: string;
  label: string;
  severity: "warning" | "info";
  quantity: number;
  amount: number;
  href: string;
}

export type FinInsightSeverity = "critical" | "warning" | "info" | "positive";

export interface FinInsightRow {
  insight_key: string;
  severity: FinInsightSeverity;
  title: string;
  detail: string;
  metric: number | null;
  href: string;
}

// -----------------------------------------------------------------------------
// Controle Financeiro simplificado (0013)
// -----------------------------------------------------------------------------
export interface FinYearCardRow {
  month: number;
  cash_in: number;
  cash_out: number;
  revenue: number;
  expenses: number;
  result: number;
  closing_balance: number;
  payables_count: number;
  payables_amount: number;
  receivables_count: number;
  receivables_amount: number;
  statement_pending: number;
  is_closed: boolean;
}

export interface CommissionReceiptRow {
  entry_id: string;
  operation_id: string;
  received_on: string;
  gross_amount: number;
}
