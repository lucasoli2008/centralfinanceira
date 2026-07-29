import Link from "next/link";
import { FileDown, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/finance/metric-card";
import { EntriesTable } from "./entries-table";
import {
  getEntryAuthors,
  getSummary,
  listActiveYears,
  listEntries,
  type EntryFilters,
} from "@/server/queries/entries";
import { listBrokers } from "@/server/queries/brokers";
import { resolvePeriod } from "@/lib/period";
import { formatCurrency } from "@/lib/formatting/number";
import { buildSearchParams } from "@/lib/utils";
import type { AmountMode, EntryType, PropertyType } from "@/lib/finance/types";

export interface EntriesSearchParams {
  periodo?: string;
  de?: string;
  ate?: string;
  ano?: string;
  mes?: string;
  busca?: string;
  corretor?: string;
  imovel?: string;
  comissao?: string;
  pagina?: string;
}

const PAGE_SIZE = 25;

export async function EntriesPage({
  entryType,
  searchParams,
}: {
  entryType: EntryType;
  searchParams: EntriesSearchParams;
}) {
  const period = resolvePeriod(searchParams);
  const page = Math.max(1, Number(searchParams.pagina) || 1);

  const filters: EntryFilters = {
    from: period.from,
    to: period.to,
    entryType,
    brokerId: searchParams.corretor || null,
    propertyType: (searchParams.imovel as PropertyType) || null,
    commissionMode: (searchParams.comissao as AmountMode) || null,
    search: searchParams.busca || null,
  };

  const [{ rows, total }, summary, brokers, years] = await Promise.all([
    listEntries(filters, { page, pageSize: PAGE_SIZE }),
    getSummary(filters),
    listBrokers({ includeInactive: true }),
    listActiveYears(),
  ]);

  const authors = await getEntryAuthors(rows);
  const isSale = entryType === "sale";

  const pdfHref = `/api/relatorios/filtrado${buildSearchParams({
    de: period.from,
    ate: period.to,
    tipo: entryType,
    corretor: filters.brokerId,
    imovel: filters.propertyType,
    comissao: filters.commissionMode,
    busca: filters.search,
  })}`;

  return (
    <>
      <PageHeader
        title={isSale ? "Vendas" : "Locações"}
        description={
          isSale
            ? "Comissões recebidas em operações de venda, no regime de caixa."
            : "Comissões recebidas na entrada de locações — sempre referentes ao primeiro aluguel."
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                <FileDown />
                Exportar PDF
              </a>
            </Button>
            <Button asChild>
              <Link href={isSale ? "/vendas/nova" : "/locacoes/nova"}>
                <Plus />
                {isSale ? "Nova venda" : "Nova locação"}
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receita líquida"
          value={formatCurrency(summary.total_net_revenue)}
          hint={period.label}
          formula="Comissão bruta − repasses aos corretores."
          emphasis
        />
        <MetricCard
          label="Comissão bruta"
          value={formatCurrency(summary.total_gross_commission)}
          hint={period.label}
          formula={
            isSale
              ? "Valor da venda × percentual da comissão, ou o valor fixo negociado."
              : "Valor do primeiro aluguel × percentual da comissão, ou o valor fixo negociado."
          }
        />
        <MetricCard
          label="Repassado aos corretores"
          value={formatCurrency(summary.total_broker_payout)}
          hint={period.label}
          formula="Soma dos repasses, cada um arredondado individualmente."
        />
        <MetricCard
          label={isSale ? "Volume de vendas" : "Soma dos primeiros aluguéis"}
          value={formatCurrency(
            isSale ? summary.sales_base_amount : summary.rental_base_amount,
          )}
          hint={`${isSale ? summary.sales_count : summary.rental_count} ${
            isSale ? "vendas" : "locações"
          } no período`}
        />
      </div>

      <EntriesTable
        entryType={entryType}
        rows={rows}
        authors={Object.fromEntries(authors)}
        brokers={brokers}
        years={years}
        totals={{
          baseAmount: isSale ? summary.sales_base_amount : summary.rental_base_amount,
          grossCommission: summary.total_gross_commission,
          brokerPayout: summary.total_broker_payout,
          netRevenue: summary.total_net_revenue,
        }}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
      />
    </>
  );
}
