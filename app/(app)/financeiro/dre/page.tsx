import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { PeriodFilter } from "@/components/finance/period-filter";
import { requireFinance } from "@/lib/auth/session";
import { resolvePeriod } from "@/lib/period";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { getDre } from "@/server/queries/finance-reports";
import { financeYears, type FinanceSearchParams } from "@/features/finance/filters";
import { DRE_MAX_MONTH_COLUMNS, DreTable } from "@/features/finance/dre-table";
import { ExportLinks } from "@/features/finance/export-links";
import { RegimeToggle } from "@/features/finance/regime-toggle";
import type { FinRegime } from "@/types/database";

export const metadata: Metadata = { title: "DRE gerencial" };

export default async function DrePage({ searchParams }: { searchParams: Promise<FinanceSearchParams> }) {
  await requireFinance("view");
  const params = await searchParams;
  if (!params.periodo) {
    const query = new URLSearchParams({ periodo: "ano-atual", ...(params.regime ? { regime: params.regime } : {}) });
    redirect(`/financeiro/dre?${query.toString()}`);
  }

  const period = resolvePeriod(params);
  const regime: FinRegime = params.regime === "caixa" ? "caixa" : "competencia";
  const dre = await getDre(period.from, period.to, regime);

  const section = (key: string) => {
    const row = dre.rows.find((item) => (item.type === "section" ? item.section.key : item.subtotal.key) === key);
    if (!row) return 0;
    return row.type === "section" ? row.section.total : row.subtotal.total;
  };

  return (
    <>
      <PageHeader
        title="DRE gerencial"
        description={`${period.label} · regime de ${regime === "caixa" ? "caixa (quando o dinheiro entrou ou saiu)" : "competência (quando o fato aconteceu)"}. Valores de terceiros nunca entram no resultado.`}
        actions={
          <ExportLinks
            tipo="dre"
            params={{ periodo: params.periodo, ano: params.ano, mes: params.mes, de: params.de, ate: params.ate, regime }}
          />
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <PeriodFilter years={financeYears()} />
        <RegimeToggle defaultRegime="competencia" />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Receita operacional bruta" value={formatCurrency(dre.grossRevenue.total)} hint="Receitas próprias da imobiliária" />
        <MetricCard label="Receita líquida" value={formatCurrency(section("net_revenue"))} hint="Depois de deduções e impostos" />
        <MetricCard label="Resultado operacional" value={formatCurrency(section("operating_result"))} hint="Antes de outras receitas e despesas" />
        <MetricCard
          label="Resultado líquido"
          value={formatCurrency(dre.netResult.total)}
          hint={dre.netMargin.total === null ? "Sem receita no período" : `Margem de ${formatPercent(dre.netMargin.total)}`}
          emphasis
          formula="Receita bruta − deduções − custos diretos − despesas operacionais + outras receitas − outras despesas. Igual ao resultado do Painel no mesmo período e regime."
        />
      </div>

      {dre.periods.length > DRE_MAX_MONTH_COLUMNS ? (
        <p className="mb-2 text-[12px] text-muted">
          Período com mais de {DRE_MAX_MONTH_COLUMNS} meses: mostramos só o total. O Excel traz todos os meses.
        </p>
      ) : null}

      <DreTable dre={dre} />
    </>
  );
}
