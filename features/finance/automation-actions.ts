"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAuditMetadata } from "@/features/entries/actions";
import {
  createFromLineSchema,
  finRecurrenceSchema,
  finRuleSchema,
  statementImportSchema,
  type CreateFromLineValues,
  type FinRecurrenceValues,
  type FinRuleValues,
  type StatementImportValues,
} from "@/lib/validation/finance-automation";
import { reasonSchema } from "@/lib/validation/finance";
import { getLineCandidates } from "@/server/queries/finance-reconciliation";
import { authorizeFinance, blankToNull, dbFailure, invalid, isFailure, revalidateFinance } from "./action-helpers";
import type { ActionResult } from "@/lib/action-result";
import type { FinLineCandidateRow } from "@/types/database";

// -----------------------------------------------------------------------------
// Extrato
// -----------------------------------------------------------------------------
export async function importStatement(
  values: StatementImportValues,
): Promise<ActionResult<{ total: number; inserted: number; duplicated: number }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = statementImportSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: result, error } = await supabase.rpc("app_fin_import_statement", {
    p_account_id: data.accountId,
    p_payload: {
      file_name: data.fileName,
      format: data.format,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      statement_balance: data.balance,
      statement_balance_date: data.balance === null ? null : data.balanceDate,
      lines: data.lines.map((line) => ({
        external_id: line.externalId,
        posted_on: line.postedOn,
        amount: line.amount,
        description: line.description,
        memo: line.memo,
        document_number: line.documentNumber,
      })),
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.importStatement", error);

  revalidateFinance();
  const counts = result as { total: number; inserted: number; duplicated: number };
  return {
    status: "ok",
    data: { total: Number(counts.total), inserted: Number(counts.inserted), duplicated: Number(counts.duplicated) },
  };
}

// -----------------------------------------------------------------------------
// Conciliação
// -----------------------------------------------------------------------------
export async function loadLineCandidates(lineId: string): Promise<FinLineCandidateRow[]> {
  const auth = await authorizeFinance("view");
  if (isFailure(auth)) return [];
  return getLineCandidates(lineId);
}

export async function matchStatementLine(lineId: string, entryId: string, settlementId: string | null): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_match_line", {
    p_line_id: lineId,
    p_entry_id: entryId,
    p_settlement_id: settlementId,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.matchStatementLine", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function confirmReconciliationSuggestions(
  accountId: string,
  lineIds?: string[],
): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_confirm_suggestions", {
    p_account_id: accountId,
    p_line_ids: lineIds && lineIds.length ? lineIds : null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.confirmReconciliationSuggestions", error);
  revalidateFinance();
  return { status: "ok", data: { count: Number(data ?? 0) } };
}

export async function settleFromStatementLine(lineId: string, entryId: string): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_settle_from_line", {
    p_line_id: lineId,
    p_entry_id: entryId,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.settleFromStatementLine", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function createFromStatementLine(lineId: string, values: CreateFromLineValues): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = createFromLineSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_create_from_line", {
    p_line_id: lineId,
    p_payload: {
      kind: data.kind,
      description: blankToNull(data.description),
      category_id: blankToNull(data.categoryId),
      counterparty_id: blankToNull(data.counterpartyId),
      cost_center_id: blankToNull(data.costCenterId),
      other_account_id: blankToNull(data.otherAccountId),
      rule_id: blankToNull(data.ruleId),
      notes: blankToNull(data.notes),
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.createFromStatementLine", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function createFromRules(lineIds: string[]): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  if (lineIds.length === 0) return { status: "error", message: "Selecione ao menos uma linha." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_create_from_rules", {
    p_line_ids: lineIds,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.createFromRules", error);
  revalidateFinance();
  return { status: "ok", data: { count: Number(data ?? 0) } };
}

export async function unmatchStatementLine(lineId: string): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_unmatch_line", { p_line_id: lineId, p_metadata: await buildAuditMetadata() });
  if (error) return dbFailure("finance.unmatchStatementLine", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function ignoreStatementLine(lineId: string, reason: string): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_ignore_line", {
    p_line_id: lineId,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.ignoreStatementLine", error);
  revalidateFinance();
  return { status: "ok" };
}

// -----------------------------------------------------------------------------
// Regras e recorrências
// -----------------------------------------------------------------------------
export async function saveFinRule(values: FinRuleValues, ruleId?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = finRuleSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("app_fin_save_rule", {
    p_payload: {
      name: data.name,
      is_active: data.isActive,
      priority: data.priority,
      match_direction: data.matchDirection,
      match_mode: data.matchMode,
      match_text: data.matchText,
      match_account_id: blankToNull(data.matchAccountId),
      amount_min: data.amountMin,
      amount_max: data.amountMax,
      category_id: data.categoryId,
      counterparty_id: blankToNull(data.counterpartyId),
      cost_center_id: blankToNull(data.costCenterId),
      description_template: blankToNull(data.descriptionTemplate),
    },
    p_rule_id: ruleId ?? null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.saveFinRule", error);
  revalidateFinance();
  return { status: "ok", data: { id: id as string } };
}

export async function saveFinRecurrence(
  values: FinRecurrenceValues,
  recurrenceId?: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = finRecurrenceSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("app_fin_save_recurrence", {
    p_payload: {
      kind: data.kind,
      description: data.description,
      amount: data.amount,
      category_id: data.categoryId,
      account_id: blankToNull(data.accountId),
      counterparty_id: blankToNull(data.counterpartyId),
      cost_center_id: blankToNull(data.costCenterId),
      property_id: blankToNull(data.propertyId),
      payment_method: blankToNull(data.paymentMethod),
      frequency: data.frequency,
      start_date: data.startDate,
      end_date: blankToNull(data.endDate),
      is_active: data.isActive,
      notes: blankToNull(data.notes),
    },
    p_recurrence_id: recurrenceId ?? null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.saveFinRecurrence", error);
  revalidateFinance();
  return { status: "ok", data: { id: id as string } };
}

export async function generateRecurrenceForecasts(horizonDays = 90): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_generate_recurrences", {
    p_horizon_days: horizonDays,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.generateRecurrenceForecasts", error);
  revalidateFinance();
  return { status: "ok", data: { count: Number(data ?? 0) } };
}
