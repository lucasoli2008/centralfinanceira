import { formatCurrency } from "@/lib/formatting/number";
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import {
  WORK_CATEGORY_LABELS,
  WORK_PRIORITY_LABELS,
  WORK_STATUS_LABELS,
} from "@/lib/formatting/labels";
import type { WorkRow } from "@/types/database";
import type { WorkTotals } from "@/lib/works/types";

export function WorkOverviewSection({ work, totals }: { work: WorkRow; totals: WorkTotals }) {
  const facts = [
    { label: "Imóvel", value: work.property_label },
    { label: "Endereço", value: work.address },
    { label: "Proprietário", value: work.owner_label },
    { label: "Responsável interno", value: work.responsible_name },
    { label: "Categoria", value: WORK_CATEGORY_LABELS[work.category] },
    { label: "Prioridade", value: WORK_PRIORITY_LABELS[work.priority] },
    { label: "Status", value: WORK_STATUS_LABELS[work.status] },
    { label: "Data da solicitação", value: work.requested_at ? formatDate(work.requested_at) : "—" },
    { label: "Data de início", value: work.started_at ? formatDate(work.started_at) : "—" },
    { label: "Previsão de conclusão", value: work.expected_at ? formatDate(work.expected_at) : "—" },
    { label: "Data de conclusão", value: work.completed_at ? formatDate(work.completed_at) : "—" },
    { label: "Criado em", value: formatDateTime(work.created_at) },
    { label: "Última atualização", value: formatDateTime(work.updated_at) },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-6">
        <section className="surface-card p-5">
          <h2 className="section-title">Informações</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="label-caption">{fact.label}</dt>
                <dd className="mt-0.5 text-[13px]">{fact.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <h3 className="label-caption">Descrição</h3>
            <p className="mt-1 whitespace-pre-line text-[13px]">{work.description}</p>
          </div>

          {work.notes ? (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="label-caption">Observações</h3>
              <p className="mt-1 whitespace-pre-line text-[13px]">{work.notes}</p>
            </div>
          ) : null}

          {work.is_archived ? (
            <div className="mt-5 rounded-control bg-surface-sunken px-4 py-3">
              <p className="text-[13px] font-medium">Obra arquivada</p>
              {work.archived_reason ? (
                <p className="mt-1 text-[13px] text-muted">{work.archived_reason}</p>
              ) : null}
              {work.archived_at ? (
                <p className="mt-1 text-xs text-subtle">{formatDateTime(work.archived_at)}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="surface-card h-fit p-5 lg:sticky lg:top-20">
        <h2 className="section-title">Custos e serviços</h2>
        <dl className="mt-4 space-y-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-muted">Materiais</dt>
            <dd className="text-[13px] font-medium tabular">{formatCurrency(totals.materialsTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-muted">Serviços</dt>
            <dd className="text-[13px] font-medium tabular">{formatCurrency(totals.servicesTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-muted">Outros custos</dt>
            <dd className="text-[13px] font-medium tabular">{formatCurrency(totals.otherTotal)}</dd>
          </div>
          <div className="border-t border-border pt-3">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] font-medium">Total geral</dt>
              <dd className="text-lg font-semibold tabular text-accent">
                {formatCurrency(totals.grandTotal)}
              </dd>
            </div>
          </div>
        </dl>
      </section>
    </div>
  );
}
