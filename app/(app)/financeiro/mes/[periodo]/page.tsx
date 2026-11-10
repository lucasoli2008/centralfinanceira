import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/finance/metric-card";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatMonthYear, todayInTimezone } from "@/lib/formatting/date";
import { cn } from "@/lib/utils";
import {
  getFinByCategory,
  getFinEntryDetail,
  getFinLookups,
  getFinSummary,
  getSignedFinAttachmentUrl,
  listFinEntries,
} from "@/server/queries/finance";
import { getCloseChecklist, getDre, listPeriodCloses } from "@/server/queries/finance-reports";
import { listMonthRecurringItems } from "@/server/queries/finance-month";
import { getReconciliationSummary, listStatementLines } from "@/server/queries/finance-reconciliation";
import { CategoryBreakdown } from "@/features/finance/finance-charts";
import { DreTable } from "@/features/finance/dre-table";
import { EntriesTable } from "@/features/finance/entries-table";
import { EntryDetailHost } from "@/features/finance/entry-detail-host";
import { MonthBills } from "@/features/finance/month-bills";
import { PeriodCloseActions } from "@/features/finance/period-close-panel";
import { QuickEntryButton } from "@/features/finance/quick-entry-sheet";
import { ReconciliationBoard } from "@/features/finance/reconciliation-board";
import { StatementImportButton } from "@/features/finance/statement-import-dialog";
import { AccountPicker } from "@/features/finance/account-picker";
import { validUuid } from "@/features/finance/filters";
import type { FinEntryStatus } from "@/types/database";

const TABS = [
  { key: "resumo", label: "Resumo" },
  { key: "saidas", label: "Saídas" },
  { key: "entradas", label: "Entradas" },
  { key: "extrato", label: "Extrato do banco" },
  { key: "resultado", label: "Resultado e fechamento" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const PAGE_SIZE = 50;

function parsePeriod(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const from = `${match[1]}-${match[2]}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { year, month, from, to };
}

function shiftPeriod(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function generateMetadata({ params }: { params: Promise<{ periodo: string }> }): Promise<Metadata> {
  const period = parsePeriod((await params).periodo);
  return { title: period ? formatMonthYear(period.year, period.month) : "Mês" };
}

export default async function FinanceMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ periodo: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const period = parsePeriod((await params).periodo);
  if (!period) notFound();
  const query = await searchParams;
  const tab: Tab = TABS.some((item) => item.key === query.aba) ? (query.aba as Tab) : "resumo";
  const { year, month, from, to } = period;
  const today = todayInTimezone();
  const label = formatMonthYear(year, month);
  const isCurrent = today >= from && today <= to;
  const defaultDate = isCurrent ? today : from;
  const ended = to < today;

  const [lookups, closes] = await Promise.all([getFinLookups(), listPeriodCloses(year)]);
  const closed = closes.find((item) => item.month === month && !item.reopened_at);

  const detailId = validUuid(query.lancamento);
  const detail = detailId ? await getFinEntryDetail(detailId) : null;
  const attachments = detail
    ? await Promise.all(detail.attachments.map(async (item) => ({ ...item, url: await getSignedFinAttachmentUrl(item.storage_path) })))
    : [];

  let body: React.ReactNode = null;

  if (tab === "resumo") {
    const [cash, competence, expenses, bills] = await Promise.all([
      getFinSummary({ from, to, regime: "caixa" }),
      getFinSummary({ from, to, regime: "competencia" }),
      getFinByCategory({ from, to, regime: "competencia" }, "expense"),
      listMonthRecurringItems(from, to),
    ]);
    body = (
      <>
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Entrou no caixa" value={formatCurrency(cash.cash_in)} hint="Recebimentos registrados no mês" />
          <MetricCard label="Saiu do caixa" value={formatCurrency(cash.cash_out)} hint="Pagamentos registrados no mês" />
          <MetricCard
            label="Resultado do mês"
            value={formatCurrency(competence.net_result)}
            emphasis
            hint="Receitas − despesas da imobiliária"
            formula="Receitas próprias menos despesas com data neste mês (competência). Repasses a proprietários e corretores não entram."
          />
          <MetricCard label="Saldo no fim do mês" value={formatCurrency(cash.cash_balance)} hint="Todas as contas" />
        </div>

        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader>
              <div>
                <CardTitle>Contas fixas do mês</CardTitle>
                <CardDescription>O que se repete todo mês. Nas de valor variável, digite o valor que veio e clique em pagar.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <MonthBills items={bills} accounts={lookups.accounts.map((item) => ({ id: item.id, name: item.name }))} canWrite={canWrite && !closed} />
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Para onde foi o dinheiro</CardTitle>
                <CardDescription>Despesas do mês por categoria.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CategoryBreakdown rows={expenses} emptyMessage="Nenhuma despesa lançada neste mês." />
            </CardContent>
          </Card>
        </div>

        {competence.third_party_obligations > 0 ? (
          <p className="mt-4 rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
            Atenção: <strong className="text-foreground">{formatCurrency(competence.third_party_obligations)}</strong> do saldo pertence a
            proprietários e corretores (repasses pendentes) — não é dinheiro da imobiliária.
          </p>
        ) : null}
      </>
    );
  } else if (tab === "saidas" || tab === "entradas") {
    const page = Math.max(1, Number(query.pagina) || 1);
    const status = query.status && query.status !== "todos" ? query.status : null;
    const { rows, total } = await listFinEntries(
      {
        view: tab === "saidas" ? "payables" : "receivables",
        from,
        to,
        dateField: "reference_date",
        status: status as FinEntryStatus | "overdue" | "pending" | null,
        counterpartyId: validUuid(query.favorecido),
        search: query.busca ?? null,
        includeCancelled: status === "cancelled",
      },
      { page, pageSize: PAGE_SIZE },
    );
    body = (
      <EntriesTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        lookups={lookups}
        canWrite={canWrite}
        mode={tab === "saidas" ? "payables" : "receivables"}
        newKind={tab === "saidas" ? "expense" : "income"}
        showCreate={false}
      />
    );
  } else if (tab === "extrato") {
    const account = lookups.accounts.find((item) => item.id === validUuid(query.conta)) ?? lookups.accounts[0];
    if (account) {
      const [summary, lines] = await Promise.all([getReconciliationSummary(account.id), listStatementLines(account.id, "all")]);
      const monthLines = lines.filter((line) => line.posted_on.slice(0, 7) === from.slice(0, 7));
      const statusFilter = (query.situacao ?? "pending") as "pending" | "matched" | "ignored" | "all";
      const visible = statusFilter === "all" ? monthLines : monthLines.filter((line) => line.status === statusFilter);
      body = (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted">
              Importe o extrato do banco (OFX ou CSV) para conferir se tudo que saiu e entrou na conta está lançado.
            </p>
            <div className="flex flex-wrap gap-2">
              <AccountPicker accounts={lookups.accounts.map((item) => ({ id: item.id, name: item.name }))} value={account.id} />
              {canWrite ? <StatementImportButton accountId={account.id} accountName={account.name} /> : null}
            </div>
          </div>
          <ReconciliationBoard
            accountId={account.id}
            lines={visible}
            status={statusFilter}
            lookups={lookups}
            canWrite={canWrite}
            suggestionCount={Math.min(visible.filter((line) => line.suggested_entry_id).length, summary.suggestions)}
            unmatchedMovements={[]}
          />
        </>
      );
    }
  } else {
    const [dre, checklist] = await Promise.all([getDre(from, to, "competencia"), getCloseChecklist(year, month)]);
    const warnings = checklist.filter((item) => item.quantity > 0 && item.severity === "warning").length;
    body = (
      <>
        <Card className="mb-5">
          <CardHeader>
            <div>
              <CardTitle>Fechamento do mês</CardTitle>
              <CardDescription>
                {closed
                  ? "Mês fechado: nada com data neste mês pode ser alterado sem reabrir."
                  : ended
                    ? `Revise os itens abaixo e feche o mês para travar os números.${warnings ? ` ${warnings} item(ns) para revisar.` : ""}`
                    : "O mês ainda não terminou."}
              </CardDescription>
            </div>
            <PeriodCloseActions
              year={year}
              month={month}
              label={label}
              isClosed={Boolean(closed)}
              canClose={financeCan(context.financeRole, "close")}
              canReopen={financeCan(context.financeRole, "admin")}
              closable={ended}
              warnings={warnings}
            />
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-[13px]">
              {checklist.map((item) => (
                <li key={item.check_key} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className={cn(item.quantity === 0 && "text-muted")}>{item.label}</span>
                  {item.quantity === 0 ? (
                    <span className="text-[12px] text-positive">Tudo certo</span>
                  ) : (
                    <Link href={item.href} className="text-[12.5px] font-medium text-accent hover:underline">
                      {item.quantity} · {formatCurrency(item.amount)} →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <h2 className="mb-2 text-[15px] font-semibold">Resultado do mês (DRE)</h2>
        <DreTable dre={dre} />
      </>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Mês anterior">
            <Link href={`/financeiro/mes/${shiftPeriod(year, month, -1)}${tab === "resumo" ? "" : `?aba=${tab}`}`}>
              <ChevronLeft />
            </Link>
          </Button>
          <div>
            <Link href={`/financeiro${year === Number(today.slice(0, 4)) ? "" : `?ano=${year}`}`} className="text-[12px] text-muted hover:underline">
              Controle Financeiro · {year}
            </Link>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold capitalize leading-tight">
              {label}
              {closed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-semibold normal-case text-positive">
                  <Lock className="size-3" /> Fechado
                </span>
              ) : isCurrent ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold normal-case text-accent">Mês atual</span>
              ) : null}
            </h1>
          </div>
          <Button asChild variant="ghost" size="icon" aria-label="Próximo mês">
            <Link href={`/financeiro/mes/${shiftPeriod(year, month, 1)}${tab === "resumo" ? "" : `?aba=${tab}`}`}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && !closed ? (
            <QuickEntryButton lookups={lookups} defaultDate={defaultDate} defaultKind={tab === "entradas" ? "income" : "expense"} />
          ) : null}
          <Button asChild variant="secondary">
            <a href={`/api/financeiro/relatorios?tipo=mes&ano=${year}&mes=${month}`} target="_blank" rel="noopener">
              <FileText />
              Relatório do mês (PDF)
            </a>
          </Button>
        </div>
      </div>

      <nav aria-label="Seções do mês" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "resumo" ? `/financeiro/mes/${year}-${String(month).padStart(2, "0")}` : `?aba=${item.key}`}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
              tab === item.key ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {body}

      {detail ? <EntryDetailHost detail={detail} attachments={attachments} lookups={lookups} canWrite={canWrite} /> : null}
    </>
  );
}
