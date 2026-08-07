import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WorkForm } from "./work-form";
import { getWork } from "@/server/queries/works";
import type { WorkFormValues } from "@/lib/validation/work";

/** Página de nova obra. */
export function NewWorkPage() {
  return (
    <>
      <PageHeader
        title="Nova obra"
        description="Cadastre uma obra, reforma ou manutenção para acompanhar custos, serviços e documentos."
        backHref="/obras"
        backLabel="Obras"
      />

      <WorkForm />
    </>
  );
}

/** Página de edição de obra. */
export async function EditWorkPage({ workId }: { workId: string }) {
  const work = await getWork(workId);
  if (!work || work.is_archived) notFound();

  const defaultValues: Partial<WorkFormValues> = {
    title: work.title,
    propertyLabel: work.property_label,
    address: work.address,
    ownerLabel: work.owner_label,
    responsibleName: work.responsible_name,
    description: work.description,
    status: work.status,
    category: work.category,
    priority: work.priority,
    requestedAt: work.requested_at ?? "",
    startedAt: work.started_at ?? "",
    expectedAt: work.expected_at ?? "",
    completedAt: work.completed_at ?? "",
    notes: work.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title="Editar obra"
        description={`${work.code} · ${work.title}`}
        backHref={`/obras/${workId}`}
        backLabel="Detalhes da obra"
      />

      <WorkForm workId={workId} defaultValues={defaultValues} />
    </>
  );
}
