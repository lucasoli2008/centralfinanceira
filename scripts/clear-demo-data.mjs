// Remove todos os dados de demonstração da organização real antes de ir para
// produção: lançamentos, repasses, fechamentos e corretores fictícios.
//
// Preserva: organização, configurações, marca (logo/cor), proprietário e
// administradores — nada de conta ou identidade é apagado.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://eridyfetqizpljjjkfgu.supabase.co";
const SERVICE_ROLE_KEY = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error("Uso: node scripts/clear-demo-data.mjs <service_role_key>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: member, error: memberError } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("role", "owner")
    .limit(1)
    .single();

  if (memberError || !member) {
    console.error("Não encontrei a organização do proprietário:", memberError?.message);
    process.exit(1);
  }

  const orgId = member.organization_id;
  console.log("Organização:", orgId);

  // 1. Reabre todos os meses fechados — senão o trigger de fechamento mensal
  //    bloqueia a exclusão dos lançamentos daquele período.
  const { error: reopenError, count: reopenedCount } = await admin
    .from("monthly_closings")
    .update({ status: "open" }, { count: "exact" })
    .eq("organization_id", orgId);

  if (reopenError) {
    console.error("Falha ao reabrir meses:", reopenError.message);
    process.exit(1);
  }
  console.log(`Meses reabertos: ${reopenedCount ?? 0}`);

  // 2. Repasses primeiro, lançamentos depois — em vez de deixar a exclusão em
  //    cascata da FK acionar o trigger de mês fechado sobre uma linha de
  //    financial_entries que já não existe mais (bug corrigido a seguir).
  const { error: splitsError, count: splitsCount } = await admin
    .from("entry_broker_splits")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (splitsError) {
    console.error("Falha ao excluir repasses:", splitsError.message);
    process.exit(1);
  }
  console.log(`Repasses removidos: ${splitsCount ?? 0}`);

  const { error: entriesError, count: entriesCount } = await admin
    .from("financial_entries")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (entriesError) {
    console.error("Falha ao excluir lançamentos:", entriesError.message);
    process.exit(1);
  }
  console.log(`Lançamentos removidos: ${entriesCount ?? 0}`);

  // 3. Registros de fechamento mensal.
  const { error: closingsError, count: closingsCount } = await admin
    .from("monthly_closings")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (closingsError) {
    console.error("Falha ao excluir fechamentos:", closingsError.message);
    process.exit(1);
  }
  console.log(`Fechamentos removidos: ${closingsCount ?? 0}`);

  // 4. Importações registradas (nenhuma esperada, mas por segurança).
  const { error: importsError, count: importsCount } = await admin
    .from("entry_imports")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (importsError) {
    console.error("Falha ao excluir importações:", importsError.message);
    process.exit(1);
  }
  console.log(`Importações removidas: ${importsCount ?? 0}`);

  // 5. Corretores fictícios.
  const { error: brokersError, count: brokersCount } = await admin
    .from("brokers")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (brokersError) {
    console.error("Falha ao excluir corretores:", brokersError.message);
    process.exit(1);
  }
  console.log(`Corretores removidos: ${brokersCount ?? 0}`);

  console.log("\nLimpeza concluída. Organização, configurações, marca e sua conta permanecem intactas.");
  console.log("Obs.: os logs de auditoria dessas ações de teste continuam em /auditoria");
  console.log("(a tabela é imutável por design). Se quiser zerá-la também, veja o final deste script.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
