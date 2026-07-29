import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BrokerFormDialog } from "@/features/brokers/broker-form";
import { requireAppContext } from "@/lib/auth/session";
import { listBrokers } from "@/server/queries/brokers";
import { getBrokerRanking } from "@/server/queries/entries";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { AMOUNT_MODE_LABELS } from "@/lib/formatting/labels";

export const metadata: Metadata = { title: "Corretores" };

export default async function CorretoresPage({
  searchParams,
}: {
  searchParams: Promise<{ inativos?: string }>;
}) {
  const { inativos } = await searchParams;
  const showInactive = inativos === "1";

  const context = await requireAppContext();
  const [brokers, ranking] = await Promise.all([
    listBrokers({ includeInactive: showInactive }),
    getBrokerRanking({}),
  ]);

  const statsById = new Map(ranking.map((row) => [row.broker_id, row]));

  return (
    <>
      <PageHeader
        title="Corretores"
        description="Registros usados nos cálculos e relatórios. Corretores não acessam o sistema."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={showInactive ? "/corretores" : "/corretores?inativos=1"}>
                {showInactive ? "Ocultar inativos" : "Exibir inativos"}
              </Link>
            </Button>
            <BrokerFormDialog defaultSplitRate={context.settings.default_broker_split_rate} />
          </>
        }
      />

      <div className="surface-card overflow-hidden">
        {brokers.length === 0 ? (
          <EmptyState
            title="Nenhum corretor cadastrado."
            description="Cadastre os corretores que participam das operações para distribuir os repasses."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Corretores cadastrados</caption>
              <THead>
                <TR>
                  <TH>Nome</TH>
                  <TH>Contato</TH>
                  <TH>Repasse padrão</TH>
                  <TH numeric>Participações</TH>
                  <TH numeric>Total recebido</TH>
                  <TH>Última participação</TH>
                  <TH>Situação</TH>
                </TR>
              </THead>
              <TBody>
                {brokers.map((broker) => {
                  const stats = statsById.get(broker.id);

                  return (
                    <TR key={broker.id}>
                      <TD>
                        <Link
                          href={`/corretores/${broker.id}`}
                          className="font-medium hover:text-accent hover:underline"
                        >
                          {broker.full_name}
                        </Link>
                        {broker.document_number ? (
                          <p className="text-xs text-subtle">
                            {broker.document_number}
                          </p>
                        ) : null}
                      </TD>
                      <TD className="text-muted">
                        {broker.email ?? "—"}
                        {broker.phone ? (
                          <p className="text-xs text-subtle">{broker.phone}</p>
                        ) : null}
                      </TD>
                      <TD>
                        {broker.default_split_mode === "percentage"
                          ? formatPercent(broker.default_split_rate)
                          : `${AMOUNT_MODE_LABELS.fixed} · ${formatCurrency(
                              broker.default_split_fixed_amount,
                            )}`}
                      </TD>
                      <TD numeric>{stats?.participations ?? 0}</TD>
                      <TD numeric>{formatCurrency(stats?.total_payout ?? 0)}</TD>
                      <TD>
                        {stats?.last_participation ? formatDate(stats.last_participation) : "—"}
                      </TD>
                      <TD>
                        {broker.is_active ? (
                          <Badge tone="positive">Ativo</Badge>
                        ) : (
                          <Badge tone="neutral">Inativo</Badge>
                        )}
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
        Participações e valores consideram todo o histórico. Corretores inativos continuam
        aparecendo nos lançamentos antigos.
      </p>
    </>
  );
}
