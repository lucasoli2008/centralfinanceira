"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/auth/session";
import { brokerSchema } from "@/lib/validation/entry";
import { isDuplicateError, logServerError, toUserMessage } from "@/lib/errors";
import { buildAuditMetadata, type ActionResult } from "@/features/entries/actions";
import type { z } from "zod";

export type BrokerFormValues = z.input<typeof brokerSchema>;

export async function saveBroker(
  values: BrokerFormValues,
  brokerId?: string,
): Promise<ActionResult<{ brokerId: string; duplicateName?: boolean }>> {
  await requireAppContext();

  const parsed = brokerSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revise os dados do corretor.",
    };
  }

  const broker = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("app_save_broker", {
    p_payload: {
      full_name: broker.fullName,
      short_name: broker.shortName ?? null,
      email: broker.email || null,
      phone: broker.phone ?? null,
      document_number: broker.documentNumber ?? null,
      default_split_mode: broker.defaultSplitMode,
      default_split_rate:
        broker.defaultSplitMode === "percentage" ? (broker.defaultSplitRate ?? null) : null,
      default_split_fixed_amount:
        broker.defaultSplitMode === "fixed" ? (broker.defaultSplitFixedAmount ?? null) : null,
      is_active: broker.isActive,
      confirm_duplicate_name: broker.confirmDuplicateName,
    },
    p_broker_id: brokerId ?? null,
    p_metadata: await buildAuditMetadata(),
  });

  if (error) {
    logServerError("brokers.saveBroker", error);
    if (isDuplicateError(error)) {
      return { status: "error", message: toUserMessage(error) };
    }
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/corretores");
  revalidatePath("/dashboard");
  if (brokerId) revalidatePath(`/corretores/${brokerId}`);

  return { status: "ok", data: { brokerId: data as string } };
}

export async function setBrokerActive(
  brokerId: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAppContext();

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("brokers")
    .update({ is_active: isActive })
    .eq("id", brokerId);

  if (error) {
    logServerError("brokers.setBrokerActive", error);
    return { status: "error", message: toUserMessage(error) };
  }

  revalidatePath("/corretores");
  revalidatePath(`/corretores/${brokerId}`);
  return { status: "ok" };
}
