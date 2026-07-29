import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportWizard } from "@/features/import/import-wizard";
import { ImportHistory } from "@/features/import/import-history";
import { requireAppContext } from "@/lib/auth/session";
import { listImports } from "@/server/queries/organization";

export const metadata: Metadata = { title: "Importar planilha" };

export default async function ImportarPage() {
  await requireAppContext();
  const imports = await listImports();

  return (
    <>
      <PageHeader
        title="Importar planilha"
        description="Traga o histórico da planilha antiga. Só as linhas de lançamento são lidas — totais, fórmulas e dashboards são ignorados, e tudo é recalculado pelo motor financeiro."
      />

      <ImportWizard />

      <Card className="mt-4 overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Importações anteriores</CardTitle>
            <CardDescription>
              Uma importação pode ser desfeita por completo enquanto os meses envolvidos estiverem
              abertos. A ação fica registrada na auditoria.
            </CardDescription>
          </div>
        </CardHeader>
        <ImportHistory imports={imports} />
      </Card>
    </>
  );
}
