import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente administrativo (service role).
 *
 * ATENÇÃO: ignora RLS. Só pode ser usado em código de servidor e apenas onde
 * for indispensável — hoje, exclusivamente no script de bootstrap do
 * proprietário e na criação de administradores convidados.
 * Nunca importe este módulo em componentes de cliente.
 */
export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada. Defina a variável no ambiente do servidor.",
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
