import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AuditFiltersBar } from "@/features/audit/audit-filters";
import { requireAppContext } from "@/lib/auth/session";
import { listAuditLogs } from "@/server/queries/organization";
import { auditActionLabel, auditEntityLabel } from "@/lib/formatting/labels";
import { formatDateTime } from "@/lib/formatting/date";
import { formatCurrency } from "@/lib/formatting/number";

export const metadata: Metadata = { title: "Auditoria" };

/** Campos cujo antes/depois interessa exibir de forma legível. */
const TRACKED_FIELDS: Record<string, { label: string; format?: (value: unknown) => string }> = {
  entry_date: { label: "Data da entrada" },
  description: { label: "Descrição" },
  base_amount: { label: "Valor-base", format: (value) => formatCurrency(Number(value)) },
  commission_mode: { label: "Forma da comissão" },
  commission_rate: { label: "Percentual da comissão" },
  commission_fixed_amount: {
    label: "Comissão fixa",
    format: (value) => formatCurrency(Number(value)),
  },
  split_rate: { label: "Percentual do repasse" },
  split_fixed_amount: { label: "Repasse fixo", format: (value) => formatCurrency(Number(value)) },
  split_mode: { label: "Forma do repasse" },
  status: { label: "Situação" },
  is_active: { label: "Ativo" },
  default_sale_commission_rate: { label: "Padrão de venda" },
  default_rental_commission_rate: { label: "Padrão de locação" },
  default_broker_split_rate: { label: "Padrão de repasse" },
  deleted_at: { label: "Exclusão" },
  full_name: { label: "Nome" },
};

function describeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { label: string; from: string; to: string }[] {
  if (!after) return [];

  return Object.entries(TRACKED_FIELDS)
    .filter(([field]) => {
      const previousValue = before?.[field];
      const nextValue = after[field];
      if (previousValue === undefined && nextValue === undefined) return false;
      return String(previousValue ?? "") !== String(nextValue ?? "");
    })
    .map(([field, config]) => ({
      label: config.label,
      from:
        before?.[field] === undefined || before?.[field] === null
          ? "—"
          : (config.format?.(before[field]) ?? String(before[field])),
      to:
        after[field] === undefined || after[field] === null
          ? "—"
          : (config.format?.(after[field]) ?? String(after[field])),
    }))
    .slice(0, 4);
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; entidade?: string; acao?: string; pagina?: string }>;
}) {
  await requireAppContext();
  const params = await searchParams;
  const page = Math.max(1, Number(params.pagina) || 1);

  const { rows, total } = await listAuditLogs({
    from: params.de,
    to: params.ate,
    entityType: params.entidade,
    action: params.acao,
    page,
    pageSize: 50,
  });

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro imutável de todas as ações financeiras relevantes. Não é possível editar ou apagar estes registros."
      />

      <AuditFiltersBar />

      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="Nenhum registro de auditoria neste filtro."
            description="Ajuste o período ou os filtros para ver o histórico de ações."
            icon="search"
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Registros de auditoria</caption>
              <THead>
                <TR>
                  <TH>Data e horário</TH>
                  <TH>Usuário</TH>
                  <TH>Ação</TH>
                  <TH>Entidade</TH>
                  <TH>Alterações</TH>
                  <TH>Contexto</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const changes = describeChanges(row.before_data, row.after_data);
                  const metadata = row.metadata as Record<string, string>;

                  return (
                    <TR key={row.id}>
                      <TD className="whitespace-nowrap tabular">{formatDateTime(row.created_at)}</TD>
                      <TD>{row.userName ?? "Sistema"}</TD>
                      <TD>
                        <Badge
                          tone={
                            row.action === "delete"
                              ? "danger"
                              : row.action === "create"
                                ? "positive"
                                : row.action === "financial_exception_confirmed"
                                  ? "warning"
                                  : "neutral"
                          }
                        >
                          {auditActionLabel(row.action)}
                        </Badge>
                      </TD>
                      <TD>{auditEntityLabel(row.entity_type)}</TD>
                      <TD>
                        {changes.length === 0 ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {changes.map((change) => (
                              <li key={change.label} className="text-xs">
                                <span className="text-muted">
                                  {change.label}:
                                </span>{" "}
                                <span className="line-through opacity-60">{change.from}</span>{" "}
                                <span className="font-medium">→ {change.to}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TD>
                      <TD className="max-w-56">
                        {metadata?.justificativa ? (
                          <p className="text-xs">
                            <span className="text-muted">Justificativa:</span>{" "}
                            {metadata.justificativa}
                          </p>
                        ) : null}
                        {metadata?.motivo ? (
                          <p className="text-xs">
                            <span className="text-muted">Motivo:</span>{" "}
                            {metadata.motivo}
                          </p>
                        ) : null}
                        {metadata?.ip ? (
                          <p className="text-xs text-subtle">IP {metadata.ip}</p>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-xs text-subtle">
        {total} registros no filtro atual · página {page}
      </p>
    </>
  );
}
