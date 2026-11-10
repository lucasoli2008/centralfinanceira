"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAuditMetadata } from "@/features/entries/actions";
import { reasonSchema } from "@/lib/validation/finance";
import { quickEntrySchema, type QuickEntryValues } from "@/lib/validation/finance-simple";
import { authorizeFinance, blankToNull, dbFailure, invalid, isFailure, revalidateFinance } from "./action-helpers";
import type { ActionResult } from "@/lib/action-result";

/** Lançamento rápido: avulso ou recorrente (fixo/variável), pago ou a pagar. */
export async function saveQuickEntry(values: QuickEntryValues): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = quickEntrySchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("app_fin_quick_entry", {
    p_payload: {
      kind: data.kind,
      description: data.description,
      amount: data.amount,
      category_id: data.categoryId,
      date: data.date,
      paid: data.paid,
      paid_on: blankToNull(data.paidOn) ?? data.date,
      account_id: blankToNull(data.accountId),
      counterparty_id: blankToNull(data.counterpartyId),
      cost_center_id: blankToNull(data.costCenterId),
      property_id: blankToNull(data.propertyId),
      recurring: data.recurring,
      notes: blankToNull(data.notes),
    },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.saveQuickEntry", error);
  revalidateFinance();
  return { status: "ok", data: { id: id as string } };
}

/** Paga uma conta (fixa ou variável) informando o valor real. */
export async function payOccurrence(
  entryId: string,
  values: { amount: number; paidOn: string; accountId: string },
): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  if (!(values.amount > 0)) return { status: "error", message: "Informe o valor pago." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paidOn)) return { status: "error", message: "Informe a data do pagamento." };
  if (!values.accountId) return { status: "error", message: "Escolha a conta." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_pay_occurrence", {
    p_entry_id: entryId,
    p_payload: { amount: values.amount, paid_on: values.paidOn, account_id: values.accountId },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.payOccurrence", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function setRecurrenceValueMode(recurrenceId: string, mode: "fixed" | "variable"): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_set_recurrence_value_mode", {
    p_recurrence_id: recurrenceId,
    p_value_mode: mode,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.setRecurrenceValueMode", error);
  revalidateFinance();
  return { status: "ok" };
}

function revalidateCommissions() {
  revalidatePath("/vendas", "layout");
  revalidatePath("/locacoes", "layout");
  revalidateFinance();
}

/** "Recebido" nas vendas/locações: lança a comissão no caixa na data informada. */
export async function markCommissionReceived(
  entryId: string,
  values: { receivedOn: string; accountId: string },
): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.receivedOn)) return { status: "error", message: "Informe a data em que o dinheiro entrou." };
  if (!values.accountId) return { status: "error", message: "Escolha a conta que recebeu." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_register_commission_receipt", {
    p_commission_entry_id: entryId,
    p_payload: { account_id: values.accountId, received_on: values.receivedOn },
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.markCommissionReceived", error);
  revalidateCommissions();
  return { status: "ok" };
}

/** Desmarca o recebimento: estorna tudo no caixa (com motivo). */
export async function unmarkCommissionReceived(operationId: string, reason: string): Promise<ActionResult> {
  const auth = await authorizeFinance("write");
  if (isFailure(auth)) return auth;
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_cancel_operation", {
    p_operation_id: operationId,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.unmarkCommissionReceived", error);
  revalidateCommissions();
  return { status: "ok" };
}
