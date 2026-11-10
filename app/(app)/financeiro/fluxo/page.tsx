import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout } from "@/components/ui/field";
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireFinance } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate, todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import { getFinMonthly } from "@/server/queries/finance";
import { getCashProjection } from "@/server/queries/finance-reports";
import { CashInOutChart, CashProjectionChart } from "@/features/finance/finance-charts";
import { ExportLinks } from "@/features/finance/export-links";
import { ParamSegmented } from "@/features/finance/regime-toggle";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const HORIZONS = ["30", "60", "90", "180"] as const;
const BUCKETS = ["day", "week", "month"] as const;
type Horizon = (typeof HORIZONS)[number];
type Bucket = (typeof BUCKETS)[number];

function bucketLabel(start: string | null, end: string | null, bucket: Bucket) {
  if (!start) return "Vencidos";
  if (bucket === "day") return formatDate(start);
  if (bucket === "month") {
    const [year, month] = start.split("-");
    return `${month}/${year}`;
  }
  return end && end !== start ? `${formatDate(start).slice(0, 5)} a ${formatDate(end).slice(0, 5)}` : formatDate(start);
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ horizonte?: string; agrupar?: string; previsoes?: string }>;
}) {
  await requireFinance("view");
  const params = await searchParams;
  const horizon: Horizon = (HORIZONS as readonly string[]).includes(params.horizonte ?? "") ? (params.horizonte as Horizon) : "90";
  const bucket: Bucket = (BUCKETS as readonly string[]).includes(params.agrupar ?? "")
    ? (params.agrupar as Bucket)
    : horizon === "180"
      ? "month"
      : "week";
  const includeForecasts = params.previsoes !== "nao";

  const today = todayInTimezone();
  const [year, month] = today.split("-").map(Number);
  const historyFrom = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);

  const [projection, history] = await Promise.all([
    getCashProjection(Number(horizon), bucket, includeForecasts),
    getFinMonthly({ from: historyFrom, to: today, regime: "caixa", accountId: null, categoryId: null, nature: null }),
  ]);

  const overdue = projection.find((row) => row.bucket_start === null);
  const future = projection.filter((row) => row.bucket_start !== null);
  const opening = projection[0]?.opening_balance ?? 0;
  const closing = projection[projection.length - 1]?.closing_balance ?? opening;
  const lowest = projection.reduce<(typeof projection)[number] | null>(
    (min, row) => (min === null || row.closing_balance < min.closing_balance ? row : min),
    null,
  );
  const thirdParty = projection.reduce((sum, row) => sum + row.third_party_out, 0);
  const firstNegative = projection.find((row) => row.closing_balance < 0);

  const points = projection.map((row) => ({
    label: bucketLabel(row.bucket_start, row.bucket_end, bucket),
    inflow: row.inflow,
    outflow: row.outflow,
    balance: row.closing_balance,
  }));

  return (
    <>
      <PageHeader
        title="Fluxo de caixa e previsão"
        description="Saldo de hoje mais tudo que está a receber e a pagar, pela data de vencimento. Previsões (recorrências) entram como estimativa; nada aqui é realizado."
        actions={<ExportLinks tipo="fluxo" pdf={false} params={{ horizonte: horizon, agrupar: bucket, previsoes: includeForecasts ? null : "nao" }} />}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <ParamSegmented
          param="horizonte"
          ariaLabel="Horizonte"
          value={horizon}
          defaultValue="90"
          options={HORIZONS.map((value) => ({ value, label: `${value} dias` }))}
        />
        <ParamSegmented
          param="agrupar"
          ariaLabel="Agrupar por"
          value={bucket}
          defaultValue={horizon === "180" ? "month" : "week"}
          options={[
            { value: "day", label: "Dia" },
            { value: "week", label: "Semana" },
            { value: "month", label: "Mês" },
          ]}
        />
        <ParamSegmented
          param="previsoes"
          ariaLabel="Previsões"
          value={includeForecasts ? "sim" : "nao"}
          defaultValue="sim"
          options={[
            { value: "sim", label: "Com previsões" },
            { value: "nao", label: "Só títulos lançados" },
          ]}
        />
      </div>

      {firstNegative ? (
        <Callout tone="danger" className="mb-5">
          O saldo projetado fica negativo {firstNegative.bucket_start ? `em ${bucketLabel(firstNegative.bucket_start, firstNegative.bucket_end, bucket)}` : "já considerando os vencidos"}:{" "}
          <strong>{formatCurrency(firstNegative.closing_balance)}</strong>. Antecipe recebimentos ou renegocie pagamentos.
        </Callout>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Saldo em contas hoje" value={formatCurrency(opening)} hint="Inclui dinheiro de terceiros ainda não repassado" />
        <MetricCard
          label={`Saldo projetado em ${horizon} dias`}
          value={formatCurrency(closing)}
          hint="Hoje + a receber − a pagar até o horizonte"
          formula="Saldo de hoje + títulos a receber − títulos a pagar (inclusive vencidos e, se marcado, previsões) com vencimento até o fim do horizonte."
        />
        <MetricCard
          label="Menor saldo no período"
          value={lowest ? formatCurrency(lowest.closing_balance) : "—"}
          hint={lowest ? bucketLabel(lowest.bucket_start, lowest.bucket_end, bucket) : undefined}
          className={lowest && lowest.closing_balance < 0 ? "border-danger/30" : undefined}
        />
        <MetricCard label="Repasses a terceiros previstos" value={formatCurrency(thirdParty)} hint="Proprietários e corretores, dentro do horizonte" />
      </div>

      <Card className="mb-5">
        <CardHeader>
          <div>
            <CardTitle>Projeção</CardTitle>
            <CardDescription>Barras: entradas e saídas previstas. Linha: saldo acumulado.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CashProjectionChart points={points} />
        </CardContent>
      </Card>

      <div className="surface-card mb-5 overflow-hidden">
        <TableWrapper>
          <Table>
            <caption className="sr-only">Fluxo de caixa projetado</caption>
            <THead>
              <TR>
                <TH>Período</TH>
                <TH numeric>Saldo inicial</TH>
                <TH numeric>Entradas</TH>
                <TH numeric>Saídas</TH>
                <TH numeric>Das quais a terceiros</TH>
                <TH numeric>Saldo final</TH>
              </TR>
            </THead>
            <TBody>
              {[...(overdue ? [overdue] : []), ...future].map((row) => (
                <TR key={row.bucket_start ?? "overdue"} className={cn(!row.bucket_start && "bg-warning-soft/40")}>
                  <TD className="font-medium">
                    {bucketLabel(row.bucket_start, row.bucket_end, bucket)}
                    {!row.bucket_start ? <span className="block text-[11.5px] font-normal text-muted">Títulos em aberto com vencimento passado</span> : null}
                  </TD>
                  <TD numeric className="text-muted">
                    {formatCurrency(row.opening_balance)}
                  </TD>
                  <TD numeric className="text-info">
                    {row.inflow ? formatCurrency(row.inflow) : "—"}
                    {row.forecast_in ? <span className="block text-[11px] text-subtle">{formatCurrency(row.forecast_in)} previsto</span> : null}
                  </TD>
                  <TD numeric>
                    {row.outflow ? formatCurrency(row.outflow) : "—"}
                    {row.forecast_out ? <span className="block text-[11px] text-subtle">{formatCurrency(row.forecast_out)} previsto</span> : null}
                  </TD>
                  <TD numeric className="text-muted">
                    {row.third_party_out ? formatCurrency(row.third_party_out) : "—"}
                  </TD>
                  <TD numeric className={cn("font-semibold", row.closing_balance < 0 && "text-danger")}>
                    {formatCurrency(row.closing_balance)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Realizado nos últimos 12 meses</CardTitle>
            <CardDescription>Entradas e saídas efetivas nas contas (baixas registradas).</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CashInOutChart series={history} />
        </CardContent>
      </Card>
    </>
  );
}
