"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppContext } from "@/lib/auth/session";
import { buildAuditMetadata } from "@/features/entries/actions";
import { financeCan, type FinanceAction } from "@/lib/finance/permissions";
import {
  finAccountSchema,
  finCategorySchema,
  finCommissionReceiptSchema,
  finCostCenterSchema,
  finCounterpartySchema,
  finEntrySchema,
  finPropertySchema,
  finRentalCollectionSchema,
  finSettlementSchema,
  reasonSchema,
  type FinAccountValues,
  type FinCategoryValues,
  type FinCommissionReceiptValues,
  type FinCostCenterValues,
  type FinCounterpartyValues,
  type FinEntryFormValues,
  type FinPropertyValues,
  type FinRentalCollectionValues,
  type FinSettlementValues,
} from "@/lib/validation/finance";
import { logServerError, toUserMessage } from "@/lib/errors";
import type { ActionResult } from "@/lib/action-result";
import type { FinanceRole } from "@/types/database";

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

type Failure = { status: "error"; message: string; fieldErrors?: Record<string, string> };

/** Checagem de permissão na borda; o banco checa de novo em cada RPC (fin_require). */
async function authorize(action: FinanceAction): Promise<{ organizationId: string } | Failure> {
  const context = await getAppContext();
  if (!context) return { status: "error", message: "Sua sessão expirou. Entre novamente." };
  if (!financeCan(context.financeRole, action)) {
    return { status: "error", message: "Você não tem permissão para esta operação no Controle Financeiro." };
  }
  return { organizationId: context.organization.id };
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && (value as Failure).status === "error";
}

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }): Failure {
  return {
    status: "error",
    message: error.issues[0]?.message ?? "Revise os valores informados.",
    fieldErrors: fieldErrorsFromZod(error),
  };
}

function dbFailure(context: string, error: unknown): Failure {
  logServerError(context, error);
  return { status: "error", message: toUserMessage(error) };
}

function revalidateFinance() {
  revalidatePath("/financeiro", "layout");
}

const blankToNull = (value: string | null | undefined) => (value === "" || value === undefined ? null : value);

// -----------------------------------------------------------------------------
// Lançamentos
// -----------------------------------------------------------------------------

export async function saveFinEntry(
  values: FinEntryFormValues,
  entryId?: string,
): Promise<ActionResult<{ entryIds: string[] }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const parsed = finEntrySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const entry = parsed.data;

  const payload = {
    kind: entry.kind,
    description: entry.description,
    amount: entry.amount,
    category_id: blankToNull(entry.categoryId),
    account_id: blankToNull(entry.accountId),
    transfer_account_id: entry.kind === "transfer" ? blankToNull(entry.transferAccountId) : null,
    adjustment_direction: entry.kind === "adjustment" ? (entry.adjustmentDirection ?? null) : null,
    counterparty_id: blankToNull(entry.counterpartyId),
    cost_center_id: blankToNull(entry.costCenterId),
    property_id: blankToNull(entry.propertyId),
    payment_method: blankToNull(entry.paymentMethod),
    competence_date: entry.competenceDate,
    due_date: blankToNull(entry.dueDate),
    is_forecast: entry.isForecast,
    settle_now: entry.settleNow,
    settled_on: blankToNull(entry.settledOn),
    installments: entry.installments,
    document_number: entry.documentNumber ?? null,
    notes: entry.notes ?? null,
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_save_entry", {
    p_payload: payload,
    p_entry_id: entryId ?? null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.saveFinEntry", error);

  revalidateFinance();
  return { status: "ok", data: { entryIds: (data as string[]) ?? [] } };
}

export async function settleFinEntry(entryId: string, values: FinSettlementValues): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const parsed = finSettlementSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_settle_entry", {
    p_entry_id: entryId,
    p_payload: {
      account_id: parsed.data.accountId,
      settled_on: parsed.data.settledOn,
      amount: parsed.data.amount,
      payment_method: blankToNull(parsed.data.paymentMethod),
      notes: parsed.data.notes ?? null,
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.settleFinEntry", error);

  revalidateFinance();
  return { status: "ok" };
}

export async function reverseFinSettlement(settlementId: string, reason: string): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_reverse_settlement", {
    p_settlement_id: settlementId,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.reverseFinSettlement", error);

  revalidateFinance();
  return { status: "ok" };
}

export async function cancelFinEntry(entryId: string, reason: string): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_cancel_entry", {
    p_entry_id: entryId,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.cancelFinEntry", error);

  revalidateFinance();
  return { status: "ok" };
}

export async function confirmFinForecast(entryId: string): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_confirm_forecast", {
    p_entry_id: entryId,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.confirmFinForecast", error);

  revalidateFinance();
  return { status: "ok" };
}

export async function bulkCategorizeFinEntries(
  entryIds: string[],
  categoryId: string,
): Promise<ActionResult<{ updated: number }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  if (entryIds.length === 0) return { status: "error", message: "Selecione ao menos um lançamento." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_bulk_categorize", {
    p_entry_ids: entryIds,
    p_category_id: categoryId,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.bulkCategorizeFinEntries", error);

  revalidateFinance();
  return { status: "ok", data: { updated: Number(data ?? 0) } };
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  matches: number;
  reason: string;
}

/** Sugestão explicável; o formulário só aplica se o usuário clicar. */
export async function suggestFinCategory(
  kind: "income" | "expense",
  description: string,
  counterpartyId?: string | null,
): Promise<CategorySuggestion | null> {
  const auth = await authorize("view");
  if (isFailure(auth)) return null;
  if (description.trim().length < 3 && !counterpartyId) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("fin_suggest_category", {
    p_kind: kind,
    p_description: description.trim(),
    p_counterparty_id: counterpartyId || null,
  });
  if (error) {
    logServerError("finance.suggestFinCategory", error);
    return null;
  }
  const row = (data as { category_id: string; category_name: string; matches: number; reason: string }[] | null)?.[0];
  return row
    ? { categoryId: row.category_id, categoryName: row.category_name, matches: Number(row.matches), reason: row.reason }
    : null;
}

// -----------------------------------------------------------------------------
// Operações imobiliárias
// -----------------------------------------------------------------------------

export async function registerRentalCollection(
  values: FinRentalCollectionValues,
): Promise<ActionResult<{ operationId: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const parsed = finRentalCollectionSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const value = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_register_rental_collection", {
    p_payload: {
      property_id: blankToNull(value.propertyId),
      owner_counterparty_id: blankToNull(value.ownerCounterpartyId),
      tenant_counterparty_id: blankToNull(value.tenantCounterpartyId),
      account_id: value.accountId,
      rent_amount: value.rentAmount,
      admin_fee_rate: value.feeMode === "rate" ? (value.adminFeeRate ?? null) : null,
      admin_fee_amount: value.feeMode === "amount" ? (value.adminFeeAmount ?? 0) : null,
      received_on: value.receivedOn,
      transfer_due_date: blankToNull(value.transferDueDate),
      reference: value.reference ?? null,
      payment_method: blankToNull(value.paymentMethod),
      notes: value.notes ?? null,
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.registerRentalCollection", error);

  revalidateFinance();
  return { status: "ok", data: { operationId: data as string } };
}

export async function registerCommissionReceipt(
  values: FinCommissionReceiptValues,
): Promise<ActionResult<{ operationId: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const parsed = finCommissionReceiptSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("app_fin_register_commission_receipt", {
    p_commission_entry_id: parsed.data.commissionEntryId,
    p_payload: {
      account_id: parsed.data.accountId,
      received_on: parsed.data.receivedOn,
      broker_due_date: blankToNull(parsed.data.brokerDueDate),
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.registerCommissionReceipt", error);

  revalidateFinance();
  return { status: "ok", data: { operationId: data as string } };
}

export async function cancelFinOperation(operationId: string, reason: string): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_cancel_operation", {
    p_operation_id: operationId,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.cancelFinOperation", error);

  revalidateFinance();
  return { status: "ok" };
}

// -----------------------------------------------------------------------------
// Cadastros
// -----------------------------------------------------------------------------

async function saveRegistry(
  rpc: string,
  idParam: string,
  payload: Record<string, unknown>,
  id: string | undefined,
  context: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(rpc, {
    p_payload: payload,
    [idParam]: id ?? null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure(context, error);
  revalidateFinance();
  return { status: "ok", data: { id: data as string } };
}

export async function saveFinAccount(values: FinAccountValues, id?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = finAccountSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return saveRegistry(
    "app_fin_save_account",
    "p_account_id",
    {
      name: v.name,
      kind: v.kind,
      bank_name: v.bankName ?? null,
      branch: v.branch ?? null,
      account_number: v.accountNumber ?? null,
      opening_balance: v.openingBalance,
      opening_date: v.openingDate,
      is_active: v.isActive,
      notes: v.notes ?? null,
    },
    id,
    "finance.saveFinAccount",
  );
}

export async function saveFinCategory(values: FinCategoryValues, id?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = finCategorySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return saveRegistry(
    "app_fin_save_category",
    "p_category_id",
    {
      name: v.name,
      parent_id: blankToNull(v.parentId),
      nature: v.nature,
      cost_behavior: blankToNull(v.costBehavior),
      is_active: v.isActive,
    },
    id,
    "finance.saveFinCategory",
  );
}

export async function saveFinCostCenter(values: FinCostCenterValues, id?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = finCostCenterSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return saveRegistry(
    "app_fin_save_cost_center",
    "p_cost_center_id",
    { name: parsed.data.name, is_active: parsed.data.isActive },
    id,
    "finance.saveFinCostCenter",
  );
}

export async function saveFinCounterparty(values: FinCounterpartyValues, id?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = finCounterpartySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return saveRegistry(
    "app_fin_save_counterparty",
    "p_counterparty_id",
    {
      name: v.name,
      kind: v.kind,
      document_number: v.documentNumber ?? null,
      email: blankToNull(v.email),
      phone: v.phone ?? null,
      broker_id: blankToNull(v.brokerId),
      notes: v.notes ?? null,
      is_active: v.isActive,
    },
    id,
    "finance.saveFinCounterparty",
  );
}

export async function saveFinProperty(values: FinPropertyValues, id?: string): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;
  const parsed = finPropertySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return saveRegistry(
    "app_fin_save_property",
    "p_property_id",
    {
      label: v.label,
      address: v.address ?? null,
      owner_counterparty_id: blankToNull(v.ownerCounterpartyId),
      admin_fee_rate: v.adminFeeRate ?? null,
      is_active: v.isActive,
      notes: v.notes ?? null,
    },
    id,
    "finance.saveFinProperty",
  );
}

// -----------------------------------------------------------------------------
// Anexos
// -----------------------------------------------------------------------------

function sanitizeForStoragePath(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned.slice(-120) || "arquivo";
}

export async function uploadFinAttachment(formData: FormData): Promise<ActionResult<{ attachmentId: string }>> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const file = formData.get("file");
  const entryId = String(formData.get("entryId") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Selecione um arquivo para enviar." };
  }
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) return { status: "error", message: "Lançamento inválido." };
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { status: "error", message: "Formato não suportado. Envie PDF, JPG, PNG ou WEBP." };
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return { status: "error", message: "Arquivo muito grande (máx. 10 MB)." };
  }

  const supabase = await createSupabaseServerClient();
  const storagePath = `${auth.organizationId}/${entryId}/${randomUUID()}-${sanitizeForStoragePath(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from("finance-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    logServerError("finance.uploadFinAttachment.storage", uploadError);
    return { status: "error", message: "Não foi possível enviar o arquivo. Tente novamente." };
  }

  const { data, error } = await supabase.rpc("app_fin_register_attachment", {
    p_payload: {
      entry_id: entryId,
      storage_path: storagePath,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      file_size_bytes: file.size,
      description: String(formData.get("description") ?? "") || null,
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) {
    await supabase.storage.from("finance-attachments").remove([storagePath]);
    return dbFailure("finance.uploadFinAttachment.register", error);
  }

  revalidateFinance();
  return { status: "ok", data: { attachmentId: data as string } };
}

export async function deleteFinAttachment(attachmentId: string): Promise<ActionResult> {
  const auth = await authorize("write");
  if (isFailure(auth)) return auth;

  const supabase = await createSupabaseServerClient();
  const { data: storagePath, error } = await supabase.rpc("app_fin_delete_attachment", {
    p_attachment_id: attachmentId,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.deleteFinAttachment", error);

  if (storagePath) {
    const { error: removeError } = await supabase.storage.from("finance-attachments").remove([storagePath as string]);
    if (removeError) logServerError("finance.deleteFinAttachment.storage", removeError);
  }

  revalidateFinance();
  return { status: "ok" };
}

// -----------------------------------------------------------------------------
// Permissões
// -----------------------------------------------------------------------------

export async function setMemberFinanceRole(memberId: string, role: FinanceRole): Promise<ActionResult> {
  const context = await getAppContext();
  if (!context?.isOwner) return { status: "error", message: "Somente o proprietário altera permissões financeiras." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_set_member_finance_role", {
    p_member_id: memberId,
    p_role: role,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.setMemberFinanceRole", error);

  revalidatePath("/configuracoes/usuarios");
  revalidateFinance();
  return { status: "ok" };
}
