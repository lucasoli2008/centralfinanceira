"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/session";
import { closeMonthSchema, reopenMonthSchema } from "@/lib/validation/entry";
import { logServerError, toUserMessage } from "@/lib/errors";
import { buildAuditMetadata, type ActionResult } from "@/features/entries/actions";

export async function closeMonth(year: number, month: number): Promise<ActionResult> {
  await requireAppContext();

  const parsed = closeMonthSchema.safeParse({ year, month });
  if (!parsed.success) {
    return { status: "error", message: "Mês inválido." };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("app_close_month", {
    p_year: year,
    p_month: month,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("months.closeMonth", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/meses");
  revalidatePath(`/meses/${year}/${month}`);
  return { status: "ok" };
}

export async function reopenMonth(
  year: number,
  month: number,
  reason: string,
): Promise<ActionResult> {
  await requireAppContext();

  const parsed = reopenMonthSchema.safeParse({ year, month, reason });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Informe a justificativa.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("app_reopen_month", {
    p_year: year,
    p_month: month,
    p_reason: parsed.data.reason,
    p_metadata: await buildAuditMetadata({ justificativa: parsed.data.reason }),
  });

  if (error) {
    logServerError("months.reopenMonth", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/meses");
  revalidatePath(`/meses/${year}/${month}`);
  revalidatePath("/auditoria");
  return { status: "ok" };
}
