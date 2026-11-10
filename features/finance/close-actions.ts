"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAuditMetadata } from "@/features/entries/actions";
import { reasonSchema } from "@/lib/validation/finance";
import { authorizeFinance, dbFailure, invalid, isFailure, revalidateFinance } from "./action-helpers";
import type { ActionResult } from "@/lib/action-result";

function validPeriod(year: number, month: number) {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

export async function closeFinPeriod(year: number, month: number, notes: string | null): Promise<ActionResult> {
  const auth = await authorizeFinance("close");
  if (isFailure(auth)) return auth;
  if (!validPeriod(year, month)) return { status: "error", message: "Mês inválido." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_close_period", {
    p_year: year,
    p_month: month,
    p_notes: notes?.trim() || null,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.closeFinPeriod", error);
  revalidateFinance();
  return { status: "ok" };
}

export async function reopenFinPeriod(year: number, month: number, reason: string): Promise<ActionResult> {
  const auth = await authorizeFinance("admin");
  if (isFailure(auth)) return auth;
  if (!validPeriod(year, month)) return { status: "error", message: "Mês inválido." };
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("app_fin_reopen_period", {
    p_year: year,
    p_month: month,
    p_reason: parsed.data,
    p_metadata: await buildAuditMetadata(),
  });
  if (error) return dbFailure("finance.reopenFinPeriod", error);
  revalidateFinance();
  return { status: "ok" };
}
