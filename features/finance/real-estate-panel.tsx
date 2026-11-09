"use client";

import * as React from "react";
import { Building, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { ENTRY_TYPE_LABELS } from "@/lib/formatting/labels";
import { CommissionReceiptDialog, RentalCollectionDialog } from "./real-estate-dialogs";
import type { FinLookups, PendingCommissionRow } from "@/server/queries/finance";

export function RentalCollectionButton({ lookups }: { lookups: FinLookups }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={lookups.accounts.length === 0}>
        <Plus />
        Registrar aluguel recebido
      </Button>
      {open ? <RentalCollectionDialog open onOpenChange={setOpen} lookups={lookups} /> : null}
    </>
  );
}

export function PendingCommissions({
  rows,
  lookups,
  canWrite,
}: {
  rows: PendingCommissionRow[];
  lookups: FinLookups;
  canWrite: boolean;
}) {
  const [target, setTarget] = React.useState<PendingCommissionRow | null>(null);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Comissões registradas ainda fora do caixa</CardTitle>
          <CardDescription>
            Vendas e locações do módulo de comissões que ainda não tiveram a entrada lançada nas contas.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="inbox" title="Todas as comissões já estão no caixa." description="Quando uma nova comissão for registrada, ela aparece aqui para ser lançada." />
        ) : (
          <TableWrapper>
            <Table>
              <caption className="sr-only">Comissões pendentes de lançamento no caixa</caption>
              <THead>
                <TR>
                  <TH>Data</TH>
                  <TH>Operação</TH>
                  <TH>Corretores</TH>
                  <TH numeric>Comissão</TH>
                  <TH numeric>Da imobiliária</TH>
                  <TH numeric>De corretores</TH>
                  <TH className="w-32">
                    <span className="sr-only">Ação</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.entry_id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(row.entry_date)}</TD>
                    <TD>
                      <span className="font-medium">{row.description}</span>
                      <span className="block text-[11.5px] text-subtle">
                        {ENTRY_TYPE_LABELS[row.entry_type]} · valor do negócio {formatCurrency(row.base_amount)}
                      </span>
                    </TD>
                    <TD className="text-muted">{row.broker_names?.join(", ") || "—"}</TD>
                    <TD numeric className="font-medium">
                      {formatCurrency(row.gross_commission)}
                    </TD>
                    <TD numeric>{formatCurrency(row.net_company_revenue)}</TD>
                    <TD numeric>{formatCurrency(row.total_broker_payout)}</TD>
                    <TD>
                      {row.exception_confirmed || row.net_company_revenue < 0 ? (
                        <Badge tone="warning">Lançar manualmente</Badge>
                      ) : canWrite ? (
                        <Button size="sm" variant="secondary" onClick={() => setTarget(row)} disabled={lookups.accounts.length === 0}>
                          Lançar no caixa
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </CardContent>
      <CommissionReceiptDialog commission={target} lookups={lookups} onClose={() => setTarget(null)} />
    </Card>
  );
}

export function NoAccountsNotice() {
  return (
    <div className="surface-card mb-5 flex items-center gap-3 px-4 py-3 text-[13px]">
      <Building className="size-4 text-subtle" />
      Cadastre ao menos uma conta financeira para registrar aluguéis e comissões.
    </div>
  );
}
