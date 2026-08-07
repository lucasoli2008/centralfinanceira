"use client";

import { FileDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { WorkOverviewSection } from "./work-overview-section";
import { WorkActivityTimeline } from "./work-activity-timeline";
import { WorkEntriesSection } from "./work-entries-section";
import { WorkGallery } from "./work-gallery";
import { WorkAttachmentsSection } from "./work-attachments-section";
import { formatCurrency } from "@/lib/formatting/number";
import type { WorkActivityRow, WorkEntryRow, WorkRow } from "@/types/database";
import type { WorkAttachmentWithUrl, WorkTotals } from "@/lib/works/types";

export function WorkDetailTabs({
  work,
  totals,
  entries,
  suppliers,
  activities,
  attachments,
}: {
  work: WorkRow;
  totals: WorkTotals;
  entries: WorkEntryRow[];
  suppliers: string[];
  activities: WorkActivityRow[];
  attachments: WorkAttachmentWithUrl[];
}) {
  const photos = attachments.filter((attachment) => attachment.category.startsWith("foto_"));
  const documents = attachments.filter((attachment) => !attachment.category.startsWith("foto_"));

  return (
    <Tabs defaultValue="visao-geral">
      <TabsList>
        <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
        <TabsTrigger value="custos">Custos e serviços</TabsTrigger>
        <TabsTrigger value="documentos">Fotos e documentos</TabsTrigger>
        <TabsTrigger value="relatorio">Relatório</TabsTrigger>
      </TabsList>

      <TabsContent value="visao-geral" className="space-y-6">
        <WorkOverviewSection work={work} totals={totals} />

        <section className="surface-card p-5">
          <h2 className="section-title">Histórico da obra</h2>
          <div className="mt-4">
            <WorkActivityTimeline activities={activities} />
          </div>
        </section>
      </TabsContent>

      <TabsContent value="custos">
        <WorkEntriesSection workId={work.id} entries={entries} totals={totals} suppliers={suppliers} />
      </TabsContent>

      <TabsContent value="documentos" className="space-y-8">
        <WorkGallery workId={work.id} photos={photos} />
        <WorkAttachmentsSection workId={work.id} documents={documents} entries={entries} />
      </TabsContent>

      <TabsContent value="relatorio">
        <div className="surface-card max-w-md p-5">
          <h2 className="section-title">Relatório completo da obra</h2>
          <p className="mt-2 text-[13px] text-muted">
            Gera um PDF com identificação, descrição, serviços, materiais, outros custos, resumo
            financeiro, fotos (antes/durante/depois) e lista de documentos.
          </p>
          <p className="mt-3 text-[13px]">
            Total geral: <span className="font-semibold tabular">{formatCurrency(totals.grandTotal)}</span>
          </p>
          <Button asChild className="mt-4">
            <a href={`/api/obras/${work.id}/relatorio`} target="_blank" rel="noopener noreferrer">
              <FileDown />
              Baixar PDF
            </a>
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
