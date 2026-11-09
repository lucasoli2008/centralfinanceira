import { requireFinance } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Callout } from "@/components/ui/field";
import { FinanceNav } from "@/features/finance/finance-nav";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  // Sem perfil financeiro com leitura, o usuário volta ao dashboard; o banco
  // recusaria os dados de qualquer forma (RLS com fin_can).
  await requireFinance("view");

  // Banco ainda sem a migração 0010: aviso claro em vez de telas com erro.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("fin_accounts").select("id").limit(1);
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    return (
      <Callout tone="warning">
        O Controle Financeiro ainda não foi ativado no banco de dados. Aplique a migração
        <code className="mx-1">supabase/migrations/0010_finance_core.sql</code>
        no SQL Editor do Supabase e recarregue a página.
      </Callout>
    );
  }

  return (
    <>
      <FinanceNav />
      {children}
    </>
  );
}
