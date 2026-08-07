import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileDown, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodFilter } from "@/components/finance/period-filter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/finance/metric-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { getWorkSummary, listActiveWorkYears, listRecentWorks } from "@/server/queries/works";
import { resolvePeriod, type PeriodParams } from "@/lib/period";
import { formatCurrency, formatInteger } from "@/lib/formatting/number";
import { formatDate } from "@/lib/formatting/date";
import { WORK_STATUS_LABELS, WORK_STATUS_TONES } from "@/lib/formatting/labels";

export const metadata: Metadata = { title: "Obras" };

export default async function ObrasPage({ searchParams }: { searchParams: Promise<PeriodParams> }) {
  const params = await searchParams;
  const period = resolvePeriod(params);

  const [summary, recentWorks, years] = await Promise.all([
    getWorkSummary({ from: period.from, to: period.to }),
    listRecentWorks(5),
    listActiveWorkYears(),
  ]);

  return (
    <>
      <PageHeader
        title="Obras"
        description="Controle de reformas, reparos e manutenções nos imóveis administrados."
        actions={
          <>
            <PeriodFilter years={years} />
            <Button asChild variant="secondary">
              <Link href="/obras/relatorios">
                <FileDown />
                Relatórios
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/obras/lista">Ver todas as obras</Link>
            </Button>
            <Button asChild>
              <Link href="/obras/nova">
                <Plus />
                Nova obra
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total de obras" value={formatInteger(summary.total)} hint={period.label} emphasis />
        <MetricCard label="Em andamento" value={formatInteger(summary.emAndamento)} hint={period.label} />
        <MetricCard label="Concluídas" value={formatInteger(summary.concluidas)} hint={period.label} />
        <MetricCard label="Pausadas" value={formatInteger(summary.pausadas)} hint={period.label} />
      </div>

      <div className="mb-6">
        <MetricCard
          label="Gasto total no período"
          value={formatCurrency(summary.gastoTotalPeriodo)}
          hint={`Materiais, serviços e outros custos — ${period.label.toLowerCase()}`}
          formula="Soma dos lançamentos (materiais + serviços + outros custos) das obras com início no período."
          className="sm:max-w-sm"
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Obras recentes</CardTitle>
            <CardDescription>As 5 obras atualizadas mais recentemente.</CardDescription>
          </div>
          <Link href="/obras/lista" className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
            Ver todas
            <ArrowRight className="size-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentWorks.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nenhuma obra cadastrada."
                description="Crie a primeira obra para começar a organizar serviços, materiais, fotos e documentos."
                actionLabel="Nova obra"
                actionHref="/obras/nova"
                icon="inbox"
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentWorks.map((work) => (
                <li key={work.id}>
                  <Link
                    href={`/obras/${work.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{work.title}</p>
                      <p className="truncate text-[12px] text-muted">
                        {work.code} · {work.property_label}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-subtle">
                        Atualizada {formatDate(work.updated_at)}
                      </span>
                      <Badge tone={WORK_STATUS_TONES[work.status]}>{WORK_STATUS_LABELS[work.status]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
