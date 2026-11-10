import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { requireFinance } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/formatting/number";
import { todayInTimezone } from "@/lib/formatting/date";
import { getFinSummary } from "@/server/queries/finance";
import { getCashProjection, getFinInsights } from "@/server/queries/finance-reports";
import { InsightList } from "@/features/finance/insight-list";

export const metadata: Metadata = { title: "Central de inteligência" };

export default async function InsightsPage() {
  await requireFinance("view");
  const today = todayInTimezone();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [insights, summary, projection] = await Promise.all([
    getFinInsights(),
    getFinSummary({ from: monthStart, to: today, regime: "caixa", accountId: null, categoryId: null, nature: null }),
    getCashProjection(90, "week"),
  ]);
  const lowest = projection.reduce<number | null>((min, row) => (min === null || row.closing_balance < min ? row.closing_balance : min), null);
  const counts = {
    critical: insights.filter((item) => item.severity === "critical").length,
    warning: insights.filter((item) => item.severity === "warning").length,
  };

  return (
    <>
      <PageHeader
        title="Central de inteligência"
        description="Alertas calculados dos seus dados reais, com a regra de cada um. Nenhum alerta executa ação: eles apontam onde olhar."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Disponível da imobiliária"
          value={formatCurrency(summary.own_available)}
          hint="Saldo em contas menos o que é de terceiros"
          className={summary.own_available < 0 ? "border-danger/30" : undefined}
        />
        <MetricCard label="Menor saldo projetado (90 dias)" value={lowest === null ? "—" : formatCurrency(lowest)} hint="Ver Fluxo de caixa" />
        <MetricCard label="Alertas críticos" value={String(counts.critical)} hint={counts.critical ? "Resolver primeiro" : "Nenhum"} />
        <MetricCard label="Pontos de atenção" value={String(counts.warning)} />
      </div>

      {insights.length === 0 ? (
        <div className="surface-card flex flex-col items-center gap-2 px-6 py-14 text-center">
          <CheckCircle2 className="size-6 text-positive" />
          <p className="text-[14px] font-semibold">Tudo em ordem.</p>
          <p className="max-w-md text-[12.5px] text-muted">
            Nenhum vencido, nenhuma pendência de conciliação e o caixa projetado fica positivo nos próximos 90 dias.
          </p>
        </div>
      ) : (
        <InsightList insights={insights} />
      )}
    </>
  );
}
