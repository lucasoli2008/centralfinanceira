import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDateTime, formatMonthYear, monthShortName, todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { getFinSummary } from "@/server/queries/finance";
import { getCloseChecklist, listPeriodCloses } from "@/server/queries/finance-reports";
import { ExportLinks } from "@/features/finance/export-links";
import { PeriodCloseActions } from "@/features/finance/period-close-panel";
import type { FinSummaryRow } from "@/types/database";

export const metadata: Metadata = { title: "Fechamento mensal" };

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export default async function PeriodClosePage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string }> }) {
  const context = await requireFinance("view");
  const params = await searchParams;
  const today = todayInTimezone();
  const [currentYear, currentMonth] = today.split("-").map(Number);
  const year = Number(params.ano) >= 2000 && Number(params.ano) <= 2100 ? Number(params.ano) : currentYear;
  const defaultMonth = year === currentYear ? Math.max(1, currentMonth - 1) : 12;
  const month = Number(params.mes) >= 1 && Number(params.mes) <= 12 ? Number(params.mes) : defaultMonth;

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = lastDay(year, month);
  const closable = to < today;

  const [closes, checklist, liveSummary] = await Promise.all([
    listPeriodCloses(year),
    getCloseChecklist(year, month),
    getFinSummary({ from, to, regime: "competencia", accountId: null, categoryId: null, nature: null }),
  ]);
  const active = closes.filter((item) => !item.reopened_at);
  const closeOf = (m: number) => active.find((item) => item.month === m);
  const selected = closeOf(month);
  const history = closes.filter((item) => item.month === month);
  const snapshot = (selected?.snapshot?.competencia as FinSummaryRow | undefined) ?? null;
  const summary: FinSummaryRow = snapshot
    ? (Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, Number(value)])) as unknown as FinSummaryRow)
    : liveSummary;
  const warnings = checklist.filter((item) => item.quantity > 0 && item.severity === "warning").length;
  const label = formatMonthYear(year, month);

  return (
    <>
      <PageHeader
        title="Fechamento mensal"
        description="Fechar um mês trava todos os lançamentos, baixas e estornos com data nele e guarda um retrato do resultado. Só um administrador reabre, com justificativa."
        actions={
          <div className="flex flex-wrap gap-2">
            {[currentYear - 1, currentYear].map((item) => (
              <Link
                key={item}
                href={`/financeiro/fechamento?ano=${item}`}
                className={cn(
                  "rounded-control border px-3 py-1.5 text-[12.5px] font-medium",
                  item === year ? "border-accent-border bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground",
                )}
              >
                {item}
              </Link>
            ))}
          </div>
        }
      />

      <nav aria-label="Meses" className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-12">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => {
          const closed = closeOf(m);
          const ended = lastDay(year, m) < today;
          return (
            <Link
              key={m}
              href={`/financeiro/fechamento?ano=${year}&mes=${m}`}
              aria-current={m === month ? "page" : undefined}
              className={cn(
                "surface-card flex flex-col items-center gap-1 px-2 py-2 text-[12.5px] transition-colors hover:bg-surface-muted",
                m === month && "ring-2 ring-accent",
              )}
            >
              <span className="font-semibold">{monthShortName(m)}</span>
              {closed ? (
                <Badge tone="positive">
                  <Lock /> Fechado
                </Badge>
              ) : ended ? (
                <Badge tone="warning">Aberto</Badge>
              ) : (
                <Badge tone="neutral">Em curso</Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold capitalize">{label}</h2>
          <p className="text-[12.5px] text-muted">
            {selected
              ? `Fechado em ${formatDateTime(selected.closed_at)}${selected.closed_by_name ? ` por ${selected.closed_by_name}` : ""}. Valores abaixo são o retrato guardado no fechamento.`
              : closable
                ? "Mês encerrado, ainda aberto para alterações."
                : "Mês em andamento — só pode ser fechado depois que terminar."}
          </p>
          {selected?.notes ? <p className="mt-1 text-[12.5px]">“{selected.notes}”</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportLinks tipo="fechamento" xlsx={false} params={{ ano: String(year), mes: String(month) }} />
          <PeriodCloseActions
            year={year}
            month={month}
            label={label}
            isClosed={Boolean(selected)}
            canClose={financeCan(context.financeRole, "close")}
            canReopen={financeCan(context.financeRole, "admin")}
            closable={closable}
            warnings={warnings}
          />
        </div>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Resultado (competência)" value={formatCurrency(summary.net_result)} emphasis />
        <MetricCard label="Receita própria" value={formatCurrency(summary.own_revenue + summary.other_revenue)} />
        <MetricCard label="Entradas no caixa" value={formatCurrency(summary.cash_in)} />
        <MetricCard label="Saídas do caixa" value={formatCurrency(summary.cash_out)} />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Checklist do fechamento</CardTitle>
            <CardDescription>Itens a revisar antes de fechar. Avisos não impedem o fechamento, mas os números podem mudar depois.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {checklist.map((item) => {
              const ok = item.quantity === 0;
              const Icon = ok ? CheckCircle2 : item.severity === "warning" ? AlertTriangle : Info;
              return (
                <li key={item.check_key} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                  <span className="flex items-center gap-2">
                    <Icon className={cn("size-4", ok ? "text-positive" : item.severity === "warning" ? "text-warning" : "text-info")} />
                    {item.label}
                  </span>
                  {ok ? (
                    <span className="text-[12px] text-subtle">Nada pendente</span>
                  ) : (
                    <Link href={item.href} className="text-[12.5px] font-medium text-accent hover:underline">
                      {item.quantity} · {formatCurrency(item.amount)} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {history.some((item) => item.reopened_at) ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico deste mês</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-[12.5px] text-muted">
              {history.map((item) => (
                <li key={item.id}>
                  Fechado em {formatDateTime(item.closed_at)}
                  {item.closed_by_name ? ` por ${item.closed_by_name}` : ""}
                  {item.reopened_at ? ` · reaberto em ${formatDateTime(item.reopened_at)}: “${item.reopen_reason}”` : " · vigente"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
