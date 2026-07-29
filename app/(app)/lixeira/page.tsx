import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RestoreEntryButton } from "@/features/entries/restore-button";
import { requireAppContext } from "@/lib/auth/session";
import { listAllEntries } from "@/server/queries/entries";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import { ENTRY_TYPE_LABELS } from "@/lib/formatting/labels";

export const metadata: Metadata = { title: "Lixeira" };

export default async function LixeiraPage() {
  await requireAppContext();
  const entries = await listAllEntries({ onlyDeleted: true });

  return (
    <>
      <PageHeader
        title="Registros excluídos"
        description="Lançamentos excluídos não entram em nenhum total. Eles podem ser restaurados enquanto o mês estiver aberto."
      />

      <div className="surface-card overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState
            title="A lixeira está vazia."
            description="Nenhum lançamento foi excluído até agora."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Lançamentos excluídos</caption>
              <THead>
                <TR>
                  <TH>Data da entrada</TH>
                  <TH>Tipo</TH>
                  <TH>Descrição</TH>
                  <TH numeric>Comissão bruta</TH>
                  <TH numeric>Receita líquida</TH>
                  <TH>Excluído em</TH>
                  <TH>Motivo</TH>
                  <TH className="w-10">
                    <span className="sr-only">Ações</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((entry) => (
                  <TR key={entry.entry_id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(entry.entry_date)}</TD>
                    <TD>{ENTRY_TYPE_LABELS[entry.entry_type]}</TD>
                    <TD>{entry.description}</TD>
                    <TD numeric>{formatCurrency(entry.gross_commission)}</TD>
                    <TD numeric>{formatCurrency(entry.net_company_revenue)}</TD>
                    <TD className="whitespace-nowrap">
                      {entry.deleted_at ? formatDateTime(entry.deleted_at) : "—"}
                    </TD>
                    <TD className="text-muted">
                      {entry.deletion_reason ?? "—"}
                    </TD>
                    <TD>
                      <RestoreEntryButton entryId={entry.entry_id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-xs text-subtle">
        A exclusão definitiva não é feita pela interface: é um procedimento administrativo
        documentado em docs/SECURITY.md.
      </p>
    </>
  );
}
