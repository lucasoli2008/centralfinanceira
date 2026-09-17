import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WorkForm } from "./work-form";
import { getWork } from "@/server/queries/works";
import type { WorkFormValues } from "@/lib/validation/work";

/** Página de nova obra, com suporte a duplicação (`?duplicar=<id>`). */
export async function NewWorkPage({ duplicateFrom }: { duplicateFrom?: string } = {}) {
  let defaultValues: Partial<WorkFormValues> | undefined;
  let sourceCode: string | null = null;

  if (duplicateFrom) {
    const source = await getWork(duplicateFrom);
    if (source) {
      sourceCode = source.code;
      defaultValues = {
        title: `${source.title} (cópia)`,
        propertyLabel: source.property_label,
        address: source.address,
        ownerLabel: source.owner_label,
        responsibleName: source.responsible_name,
        description: source.description,
        status: "planejada",
        category: source.category,
        priority: source.priority,
        requestedAt: new Date().toISOString().slice(0, 10),
        startedAt: "",
        expectedAt: "",
        completedAt: "",
        notes: source.notes ?? "",
      };
    }
  }

  return (
    <>
      <PageHeader
        title="Nova obra"
        description={
          sourceCode
            ? `Copiando dados da obra ${sourceCode}. Itens, fotos e documentos não são copiados.`
            : "Cadastre uma obra, reforma ou manutenção para acompanhar custos, serviços e documentos."
        }
        backHref="/obras"
        backLabel="Obras"
      />

      <WorkForm defaultValues={defaultValues} />
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
