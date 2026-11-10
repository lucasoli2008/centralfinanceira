import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, Info, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinInsightRow, FinInsightSeverity } from "@/types/database";

/** Como cada alerta é calculado — exibido junto do alerta (nada é caixa-preta). */
export const INSIGHT_EXPLANATIONS: Record<string, string> = {
  own_available_negative: "Saldo em contas − obrigações com terceiros − cauções. Negativo = parte do dinheiro de terceiros já foi usada.",
  projection_negative: "Fluxo projetado de 90 dias, por semana: saldo de hoje + a receber − a pagar (inclui vencidos e previsões).",
  third_party_overdue: "Títulos a pagar com natureza 'valores de terceiros' (repasses) em aberto e com vencimento passado.",
  payables_overdue: "Contas a pagar da imobiliária (sem repasses) em aberto com vencimento passado.",
  receivables_overdue: "Contas a receber em aberto com vencimento passado.",
  forecast_past: "Previsões (recorrências) cuja data já passou sem confirmação ou baixa.",
  statement_stale: "Linhas importadas do extrato bancário, pendentes há mais de 7 dias.",
  commissions_out: "Comissões do módulo de vendas/locações sem operação de entrada no caixa.",
  last_month_open: "O mês anterior tem movimentos no livro-razão e não foi fechado.",
  result_trend: "Resultado líquido (competência) do mês anterior comparado ao mês antes dele.",
  expense_spike: "Despesa da categoria no mês anterior acima de 130% da média dos 3 meses antes (e ao menos R$ 200 a mais).",
};

const STYLES: Record<FinInsightSeverity, { icon: typeof Info; tone: string; label: string }> = {
  critical: { icon: AlertOctagon, tone: "border-danger/40 bg-danger-soft/50 text-danger", label: "Crítico" },
  warning: { icon: AlertTriangle, tone: "border-warning/40 bg-warning-soft/50 text-warning", label: "Atenção" },
  info: { icon: Info, tone: "border-border bg-surface text-info", label: "Informação" },
  positive: { icon: TrendingUp, tone: "border-positive/30 bg-positive-soft/50 text-positive", label: "Bom sinal" },
};

export function InsightList({ insights, explain = true }: { insights: FinInsightRow[]; explain?: boolean }) {
  return (
    <ul className="grid gap-3">
      {insights.map((insight, index) => {
        const style = STYLES[insight.severity];
        const Icon = style.icon;
        return (
          <li key={`${insight.insight_key}-${index}`}>
            <Link
              href={insight.href}
              className={cn("group flex items-start gap-3 rounded-card border px-4 py-3 transition-colors hover:bg-surface-muted", style.tone)}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1 text-foreground">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{insight.title}</span>
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-subtle">{style.label}</span>
                </span>
                <span className="block text-[12.5px] text-muted">{insight.detail}</span>
                {explain && INSIGHT_EXPLANATIONS[insight.insight_key] ? (
                  <span className="mt-1 block text-[11.5px] text-subtle">Como calculamos: {INSIGHT_EXPLANATIONS[insight.insight_key]}</span>
                ) : null}
              </span>
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
