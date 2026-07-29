import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BrokerFormDialog, BrokerStatusToggle } from "@/features/brokers/broker-form";
import { requireAppContext } from "@/lib/auth/session";
import { getBroker } from "@/server/queries/brokers";
import { getBrokerRanking, getBrokerStatement } from "@/server/queries/entries";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { AMOUNT_MODE_LABELS, ENTRY_TYPE_LABELS } from "@/lib/formatting/labels";

export const metadata: Metadata = { title: "Corretor" };

export default async function CorretorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireAppContext();
  const broker = await getBroker(id);

  if (!broker) notFound();

  const [statement, ranking] = await Promise.all([
    getBrokerStatement(id, null, null),
    getBrokerRanking({ brokerId: id }),
  ]);

  const stats = ranking[0];

  return (
    <>
      <PageHeader
        title={broker.full_name}
        description={
          broker.is_active
            ? "Corretor ativo — aparece na seleção de novos lançamentos."
            : "Corretor inativo — continua visível nos lançamentos antigos."
        }
        backHref="/corretores"
        backLabel="Corretores"
        actions={
          <>
            <Button asChild variant="secondary">
              <a
                href={`/api/relatorios/corretor?corretor=${broker.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileDown />
                Relatório em PDF
              </a>
            </Button>
            <BrokerStatusToggle broker={broker} />
            <BrokerFormDialog
              broker={broker}
              defaultSplitRate={context.settings.default_broker_split_rate}
              trigger={<Button>Editar corretor</Button>}
            />
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total recebido"
          value={formatCurrency(stats?.total_payout ?? 0)}
          hint="Soma de todos os repasses"
          emphasis
        />
        <MetricCard
          label="Participações"
          value={String(stats?.participations ?? 0)}
          hint="Lançamentos em que participou"
        />
        <MetricCard
          label="Média por operação"
          value={formatCurrency(stats?.average_payout ?? 0)}
          hint="Total recebido ÷ participações"
        />
        <MetricCard
          label="Volume das operações"
          value={formatCurrency(stats?.participated_base_amount ?? 0)}
          hint="Valor-base das operações em que participou"
          formula="Soma do valor da venda ou do primeiro aluguel das operações em que o corretor participou. Não é receita do corretor."
        />
      </div>

      <section className="surface-card mb-6 p-5">
        <h2 className="section-title">Cadastro</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="label-caption">CRECI</dt>
            <dd className="mt-0.5 text-[13px]">{broker.document_number ?? "—"}</dd>
          </div>
          <div>
            <dt className="label-caption">E-mail</dt>
            <dd className="mt-0.5 text-[13px]">{broker.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="label-caption">Telefone</dt>
            <dd className="mt-0.5 text-[13px]">{broker.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="label-caption">Repasse padrão</dt>
            <dd className="mt-0.5 text-[13px]">
              {broker.default_split_mode === "percentage"
                ? formatPercent(broker.default_split_rate)
                : `${AMOUNT_MODE_LABELS.fixed} · ${formatCurrency(broker.default_split_fixed_amount)}`}
            </dd>
          </div>
          <div>
            <dt className="label-caption">Situação</dt>
            <dd className="mt-0.5">
              {broker.is_active ? (
                <Badge tone="positive">Ativo</Badge>
              ) : (
                <Badge tone="neutral">Inativo</Badge>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="section-title">Histórico de participações</h2>
          <p className="mt-0.5 text-xs text-subtle">
            Todos os lançamentos em que o corretor participou, com o repasse calculado.
          </p>
        </div>

        {statement.length === 0 ? (
          <EmptyState
            title="Nenhuma participação registrada."
            description="Assim que este corretor participar de um lançamento, o histórico aparece aqui."
          />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Participações do corretor</caption>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Tipo</TH>
                  <TH>Descrição</TH>
                  <TH numeric>Valor-base</TH>
                  <TH numeric>Comissão bruta</TH>
                  <TH numeric>Repasse aplicado</TH>
                  <TH numeric>Valor recebido</TH>
                </TR>
              </THead>
              <TBody>
                {statement.map((row) => (
                  <TR key={`${row.entry_id}`}>
                    <TD className="whitespace-nowrap tabular">{formatDate(row.entry_date)}</TD>
                    <TD>{ENTRY_TYPE_LABELS[row.entry_type]}</TD>
                    <TD>
                      <Link
                        href={`${row.entry_type === "sale" ? "/vendas" : "/locacoes"}/${row.entry_id}`}
                        className="hover:text-accent hover:underline"
                      >
                        {row.description}
                      </Link>
                    </TD>
                    <TD numeric>{formatCurrency(row.base_amount)}</TD>
                    <TD numeric>{formatCurrency(row.gross_commission)}</TD>
                    <TD numeric>
                      {row.split_mode === "percentage"
                        ? formatPercent(row.split_rate)
                        : AMOUNT_MODE_LABELS.fixed}
                    </TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(row.payout_amount)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </section>
    </>
  );
}
