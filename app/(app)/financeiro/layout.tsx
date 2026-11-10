import { requireFinance } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Callout } from "@/components/ui/field";

const MISSING = ["42P01", "PGRST205", "42703", "PGRST204", "42883", "PGRST202"];

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  // Sem perfil financeiro com leitura, o usuário volta ao dashboard; o banco
  // recusaria os dados de qualquer forma (RLS com fin_can).
  await requireFinance("view");

  // Banco sem as migrações do financeiro: aviso claro em vez de telas vazias.
  // Confere a coluna da 0013 (a 0014 só acrescenta "parar de repetir", que avisa se faltar).
  const supabase = await createSupabaseServerClient();
  const column = await supabase.from("fin_recurrences").select("value_mode").limit(1);
  const missing = Boolean(column.error && MISSING.includes(column.error.code ?? ""));
  if (missing) {
    return (
      <Callout tone="warning">
        O Controle Financeiro ainda não foi ativado no banco de dados. Abra o SQL Editor do Supabase, cole o arquivo
        <code className="mx-1">supabase/apply-finance.sql</code>
        inteiro e clique em Run. Depois recarregue esta página.
      </Callout>
    );
  }

  return <>{children}</>;
}
