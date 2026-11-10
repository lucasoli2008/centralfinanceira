import { requireFinance } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Callout } from "@/components/ui/field";
import { FinanceNav } from "@/features/finance/finance-nav";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  // Sem perfil financeiro com leitura, o usuário volta ao dashboard; o banco
  // recusaria os dados de qualquer forma (RLS com fin_can).
  await requireFinance("view");

  // Banco sem as migrações do financeiro: aviso claro em vez de telas com erro.
  // Confere a tabela da migração mais recente (0012); se ela existe, as anteriores também.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("fin_period_closes").select("id").limit(1);
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    return (
      <Callout tone="warning">
        O Controle Financeiro ainda não está completo no banco de dados. Aplique, nesta ordem, no SQL Editor do Supabase as
        migrações que ainda não rodou:
        <code className="mx-1">0010_finance_core.sql</code>,<code className="mx-1">0011_finance_reconciliation.sql</code> e
        <code className="mx-1">0012_finance_reports_close.sql</code> (pasta <code>supabase/migrations</code>). Depois recarregue a
        página.
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
