import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportLauncher } from "@/features/reports/report-launcher";
import { requireAppContext } from "@/lib/auth/session";
import { listBrokers } from "@/server/queries/brokers";
import { listActiveYears } from "@/server/queries/entries";

export const metadata: Metadata = { title: "Relatórios" };

export default async function RelatoriosPage() {
  await requireAppContext();

  const [brokers, years] = await Promise.all([
    listBrokers({ includeInactive: true }),
    listActiveYears(),
  ]);

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="PDFs gerados no servidor a partir das mesmas consultas do dashboard — os totais sempre batem."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Relatório mensal</CardTitle>
              <CardDescription>
                Resumo do mês, comparação com o mês anterior, lançamentos detalhados e resumo por
                corretor.
              </CardDescription>
            </div>
            <FileDown className="size-4 text-subtle" />
          </CardHeader>
          <CardContent>
            <ReportLauncher type="mensal" years={years} brokers={brokers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Relatório anual</CardTitle>
              <CardDescription>
                Consolidação dos 12 meses, gráfico impresso, tabela mensal e ranking anual.
              </CardDescription>
            </div>
            <FileDown className="size-4 text-subtle" />
          </CardHeader>
          <CardContent>
            <ReportLauncher type="anual" years={years} brokers={brokers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Relatório por corretor</CardTitle>
              <CardDescription>
                Participações, percentuais aplicados, valor de cada repasse e média por operação.
              </CardDescription>
            </div>
            <FileDown className="size-4 text-subtle" />
          </CardHeader>
          <CardContent>
            <ReportLauncher type="corretor" years={years} brokers={brokers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Relatório filtrado</CardTitle>
              <CardDescription>
                Período, tipo de entrada, corretor e tipo de imóvel. O PDF lista os filtros
                aplicados.
              </CardDescription>
            </div>
            <FileDown className="size-4 text-subtle" />
          </CardHeader>
          <CardContent>
            <ReportLauncher type="filtrado" years={years} brokers={brokers} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
