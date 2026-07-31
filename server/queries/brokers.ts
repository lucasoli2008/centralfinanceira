import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import { rankBrokerMatches } from "@/lib/ai/broker-match";
import type { BrokerRow } from "@/types/database";

export async function listBrokers({
  includeInactive = false,
}: { includeInactive?: boolean } = {}): Promise<BrokerRow[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase.from("brokers").select("*").order("full_name");
  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;

  if (error) {
    logServerError("queries.listBrokers", error);
    return [];
  }

  return (data ?? []) as BrokerRow[];
}

export async function getBroker(brokerId: string): Promise<BrokerRow | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.from("brokers").select("*").eq("id", brokerId).maybeSingle();

  return (data as BrokerRow | null) ?? null;
}

/**
 * Encontra corretores pelo nome falado/digitado (usado pelo assistente de IA
 * para traduzir "corretora Ana" no `broker_id` real). Inclui inativos, para
 * não esconder histórico de quem já saiu da imobiliária.
 */
export async function findBrokersByName(query: string): Promise<BrokerRow[]> {
  const brokers = await listBrokers({ includeInactive: true });
  return rankBrokerMatches(query, brokers);
}
