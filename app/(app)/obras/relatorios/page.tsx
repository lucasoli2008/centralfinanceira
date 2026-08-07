import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkReportLauncher } from "@/features/works/work-report-launcher";

export const metadata: Metadata = { title: "Relatórios de obras" };

export default function ObrasRelatoriosPage() {
  return (
    <>
      <PageHeader
        title="Relatórios de obras"
        description="PDF ou CSV com todas as obras que atendem aos filtros selecionados."
        backHref="/obras"
        backLabel="Obras"
      />

      <Card className="max-w-xl">
        <CardHeader>
          <div>
            <CardTitle>Relatório geral</CardTitle>
            <CardDescription>
              Filtre por período de início, status e categoria. O PDF lista os filtros aplicados;
              o CSV é o mesmo conjunto de dados, pronto para planilhas.
            </CardDescription>
          </div>
          <FileDown className="size-4 text-subtle" />
        </CardHeader>
        <CardContent>
          <WorkReportLauncher />
        </CardContent>
      </Card>
    </>
  );
}
