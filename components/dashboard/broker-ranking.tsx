import * as React from "react";
import Link from "next/link";
import { cn, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { ShareBar } from "@/components/finance/sparkline";
import { Table, TableWrapper, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { formatCurrency, formatInteger, formatPercent } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import type { BrokerRankingRow } from "@/types/database";

/**
 * Ranking de corretores com barra de participação.
 *
 * A barra compara o repasse de cada corretor com o do primeiro colocado — deixa
 * claro quem concentra os repasses sem sugerir que a comissão bruta inteira é
 * receita individual do corretor.
 */
export function BrokerRanking({
  ranking,
  totalPayout,
  className,
}: {
  ranking: BrokerRankingRow[];
  totalPayout: number;
  className?: string;
}) {
  if (ranking.length === 0) {
    return (
      <EmptyState
        title="Nenhum repasse registrado neste período."
        description="Assim que houver lançamentos com corretores, o ranking aparece aqui."
        className={className}
      />
    );
  }

  const top = Number(ranking[0].total_payout) || 1;

  return (
    <TableWrapper className={className}>
      <Table>
        <caption className="sr-only">Ranking de corretores do período</caption>
        <THead>
          <TR>
            <TH className="w-8">
              <span className="sr-only">Posição</span>
            </TH>
            <TH>Corretor</TH>
            <TH className="w-[19%]">Participação nos repasses</TH>
            <TH numeric>Total recebido</TH>
            <TH numeric>Particip.</TH>
            <TH numeric>Média/operação</TH>
            <TH numeric>Volume das operações</TH>
            <TH>Última</TH>
          </TR>
        </THead>

        <TBody>
          {ranking.map((row, index) => {
            const payout = Number(row.total_payout);
            const share = totalPayout > 0 ? (payout / totalPayout) * 100 : 0;

            return (
              <TR key={row.broker_id} className="group">
                <TD className="text-center">
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-full text-[10.5px] font-semibold",
                      index === 0
                        ? "bg-accent text-accent-foreground"
                        : index < 3
                          ? "bg-accent-muted text-accent"
                          : "bg-surface-muted text-subtle",
                    )}
                  >
                    {index + 1}
                  </span>
                </TD>

                <TD>
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[10.5px] font-semibold text-muted"
                    >
                      {initials(row.broker_name)}
                    </span>
                    <span className="min-w-0">
                      <Link
                        href={`/corretores/${row.broker_id}`}
                        className="block truncate font-medium hover:text-accent hover:underline"
                      >
                        {row.broker_name}
                      </Link>
                      {row.broker_is_active ? null : (
                        <Badge tone="neutral" className="mt-0.5">
                          Inativo
                        </Badge>
                      )}
                    </span>
                  </div>
                </TD>

                <TD>
                  <div className="flex items-center gap-2">
                    <ShareBar value={payout} total={top} className="w-full min-w-14" />
                    <span className="w-9 shrink-0 text-right text-[11.5px] tabular text-subtle">
                      {formatPercent(share, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </TD>

                <TD numeric className="font-semibold">
                  {formatCurrency(payout)}
                </TD>
                <TD numeric className="text-muted">
                  {formatInteger(row.participations)}
                </TD>
                <TD numeric className="text-muted">
                  {formatCurrency(row.average_payout)}
                </TD>
                <TD numeric className="text-muted">
                  {formatCurrency(row.participated_base_amount)}
                </TD>
                <TD className="whitespace-nowrap text-muted">
                  {row.last_participation ? formatDate(row.last_participation) : "—"}
                </TD>
              </TR>
            );
          })}
        </TBody>

        <TFoot>
          <TR className="hover:bg-transparent">
            <TD />
            <TD>Total repassado</TD>
            <TD />
            <TD numeric>{formatCurrency(totalPayout)}</TD>
            <TD numeric>
              {formatInteger(ranking.reduce((sum, row) => sum + row.participations, 0))}
            </TD>
            <TD colSpan={3} />
          </TR>
        </TFoot>
      </Table>
    </TableWrapper>
  );
}
