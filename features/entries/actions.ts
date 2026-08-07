"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/session";
import { entrySchema, type EntryFormValues } from "@/lib/validation/entry";
import { logServerError, toUserMessage } from "@/lib/errors";
import type { ActionResult } from "@/lib/action-result";

export type { ActionResult } from "@/lib/action-result";

function revalidateEntryPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/vendas");
  revalidatePath("/locacoes");
  revalidatePath("/meses");
  revalidatePath("/relatorios");
  revalidatePath("/auditoria");
  revalidatePath("/lixeira");
}

/**
 * Contexto da requisição (IP e navegador) enviado junto de cada operação para a
 * auditoria. Nada sensível é gravado: apenas o suficiente para rastrear a ação.
 */
export async function buildAuditMetadata(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const metadata: Record<string, string> = { ...extra };

  try {
    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = headerList.get("user-agent");

    if (ip) metadata.ip = ip;
    if (userAgent) metadata.navegador = userAgent.slice(0, 180);
  } catch {
    // A auditoria de contexto é complementar: nunca impede a operação.
  }

  return metadata;
}

export async function saveEntry(
  values: EntryFormValues,
  entryId?: string,
): Promise<ActionResult<{ entryId: string }>> {
  await requireAppContext();

  const parsed = entrySchema.safeParse(values);

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      if (!fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os valores informados.",
      fieldErrors,
    };
  }

  const entry = parsed.data;
  const supabase = await createSupabaseServerClient();
  const metadata = await buildAuditMetadata(
    entry.exceptionConfirmed ? { justificativa: entry.exceptionReason ?? "" } : {},
  );

  const payload = {
    entry_type: entry.entryType,
    entry_date: entry.entryDate,
    description: entry.description,
    reference: entry.reference ?? null,
    property_type: entry.propertyType,
    base_amount: entry.baseAmount,
    commission_mode: entry.commissionMode,
    commission_rate: entry.commissionMode === "percentage" ? entry.commissionRate : null,
    commission_fixed_amount: entry.commissionMode === "fixed" ? entry.commissionFixedAmount : null,
    notes: entry.notes ?? null,
    exception_confirmed: entry.exceptionConfirmed,
    exception_reason: entry.exceptionReason ?? null,
    splits: entry.splits.map((split) => ({
      broker_id: split.brokerId,
      split_mode: split.splitMode,
      split_rate: split.splitMode === "percentage" ? split.splitRate : null,
      split_fixed_amount: split.splitMode === "fixed" ? split.splitFixedAmount : null,
    })),
  };

  const { data, error } = await supabase.rpc("app_save_entry", {
    p_payload: payload,
    p_entry_id: entryId ?? null,
    p_metadata: metadata,
  });

  if (error) {
    logServerError("entries.saveEntry", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateEntryPaths();
  if (entryId) {
    revalidatePath(`/vendas/${entryId}`);
    revalidatePath(`/locacoes/${entryId}`);
  }

  return { status: "ok", data: { entryId: data as string } };
}

export async function deleteEntry(entryId: string, reason?: string): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("app_delete_entry", {
    p_entry_id: entryId,
    p_reason: reason ?? null,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("entries.deleteEntry", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateEntryPaths();
  return { status: "ok" };
}

export async function restoreEntry(entryId: string): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("app_restore_entry", {
    p_entry_id: entryId,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("entries.restoreEntry", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidateEntryPaths();
  return { status: "ok" };
}
