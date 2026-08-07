import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WorkDetailTabs } from "@/features/works/work-detail-tabs";
import { WorkDetailActions } from "@/features/works/work-detail-actions";
import {
  getSignedAttachmentUrl,
  getWork,
  getWorkEntryTotals,
  listRecentSuppliers,
  listWorkActivities,
  listWorkAttachments,
  listWorkEntries,
} from "@/server/queries/works";
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from "@/lib/formatting/labels";
import type { WorkAttachmentWithUrl } from "@/lib/works/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const work = await getWork(id);
  return { title: work ? work.title : "Obra" };
}

export default async function ObraDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await getWork(id);

  if (!work) notFound();

  const [totals, entries, activities, suppliers, attachmentRows] = await Promise.all([
    getWorkEntryTotals(id),
    listWorkEntries(id),
    listWorkActivities(id),
    listRecentSuppliers(),
    listWorkAttachments(id),
  ]);

  const attachments: WorkAttachmentWithUrl[] = await Promise.all(
    attachmentRows.map(async (attachment) => ({
      ...attachment,
      url: await getSignedAttachmentUrl(attachment.storage_path),
    })),
  );

  return (
    <>
      <PageHeader
        title={work.title}
        description={`${work.code} · ${work.property_label}`}
        backHref="/obras/lista"
        backLabel="Todas as obras"
        actions={
          <>
            <Badge tone={WORK_STATUS_TONES[work.status]}>{WORK_STATUS_LABELS[work.status]}</Badge>
            {work.is_archived ? null : (
              <Button asChild variant="secondary">
                <Link href={`/obras/${id}/editar`}>
                  <Pencil />
                  Editar
                </Link>
              </Button>
            )}
            <WorkDetailActions workId={id} isArchived={work.is_archived} />
          </>
        }
      />

      <WorkDetailTabs
        work={work}
        totals={totals}
        entries={entries}
        suppliers={suppliers}
        activities={activities}
        attachments={attachments}
      />
    </>
  );
}
