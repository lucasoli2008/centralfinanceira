"use client";

import { FileDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { WorkOverviewSection } from "./work-overview-section";
import { WorkActivityTimeline } from "./work-activity-timeline";
import { WorkEntriesSection } from "./work-entries-section";
import { WorkGallery } from "./work-gallery";
import { WorkAttachmentsSection } from "./work-attachments-section";
import { isPhotoCategory } from "./attachment-files";
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
  attachmentCounts,
}: {
  work: WorkRow;
  totals: WorkTotals;
  entries: WorkEntryRow[];
  suppliers: string[];
  activities: WorkActivityRow[];
  attachments: WorkAttachmentWithUrl[];
  attachmentCounts: Record<string, number>;
}) {
  const photos = attachments.filter((attachment) => isPhotoCategory(attachment.category));
  const documents = attachments.filter((attachment) => !isPhotoCategory(attachment.category));
  const readOnly = work.is_archived;

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
        <WorkEntriesSection
          workId={work.id}
          entries={entries}
          totals={totals}
          suppliers={suppliers}
          attachments={attachments}
          attachmentCounts={attachmentCounts}
          readOnly={readOnly}
        />
      </TabsContent>

      <TabsContent value="documentos" className="space-y-8">
        <WorkGallery workId={work.id} photos={photos} entries={entries} readOnly={readOnly} />
        <WorkAttachmentsSection workId={work.id} documents={documents} entries={entries} readOnly={readOnly} />
      </TabsContent>

      <TabsContent value="relatorio">
        <div className="surface-card max-w-md p-5">
          <h2 className="section-title">Relatório completo da obra</h2>
          <p className="mt-2 text-[13px] text-muted">
            PDF com identificação, resumo financeiro (pago e a pagar), serviços, materiais e outros
            custos, fotos antes/durante/depois com legenda, notas fiscais e comprovantes — os PDFs
            anexados entram como páginas no final.
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
            <div>
              <dt className="label-caption">Total</dt>
              <dd className="font-semibold tabular">{formatCurrency(totals.grandTotal)}</dd>
            </div>
            <div>
              <dt className="label-caption">Fotos</dt>
              <dd className="font-semibold tabular">{photos.length}</dd>
            </div>
            <div>
              <dt className="label-caption">Documentos</dt>
              <dd className="font-semibold tabular">{documents.length}</dd>
            </div>
          </dl>
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
