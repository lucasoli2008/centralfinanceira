import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/finance/metric-card";
import { Callout } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import { getFinLookups } from "@/server/queries/finance";
import {
  getReconciliationSummary,
  listBankImports,
  listStatementLines,
  listUnmatchedMovements,
} from "@/server/queries/finance-reconciliation";
import { validUuid } from "@/features/finance/filters";
import { AccountPicker } from "@/features/finance/account-picker";
import { ReconciliationBoard } from "@/features/finance/reconciliation-board";
import { StatementImportButton } from "@/features/finance/statement-import-dialog";
import type { FinStatementLineStatus } from "@/types/database";

export const metadata: Metadata = { title: "Conciliação bancária" };

const STATUSES = ["pending", "matched", "ignored", "all"] as const;

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ conta?: string; situacao?: string }>;
}) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const params = await searchParams;
  const lookups = await getFinLookups();
  const accounts = lookups.accounts;

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Conciliação bancária" />
        <div className="surface-card">
          <EmptyState
            title="Nenhuma conta cadastrada."
            description="Cadastre a conta bancária com o saldo inicial para importar o extrato e conciliar."
            actionLabel={canWrite ? "Cadastrar conta" : undefined}
            actionHref={canWrite ? "/financeiro/cadastros?aba=contas&novo=1" : undefined}
          />
        </div>
      </>
    );
  }

  const requested = validUuid(params.conta);
  const account = accounts.find((item) => item.id === requested) ?? accounts[0];
  const status = (STATUSES as readonly string[]).includes(params.situacao ?? "")
    ? (params.situacao as FinStatementLineStatus | "all")
    : "pending";

  const [summary, lines, imports] = await Promise.all([
    getReconciliationSummary(account.id),
    listStatementLines(account.id, status),
    listBankImports(account.id, 5),
  ]);
  const unmatched = status === "pending" ? await listUnmatchedMovements(account.id, summary.first_line_date, summary.last_line_date) : [];

  const difference = summary.difference;
  const reconciled = difference !== null && Math.abs(difference) < 0.005 && summary.pending_lines === 0;

  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        description="Compare o extrato do banco com os lançamentos. Conciliar não move dinheiro: só confirma que o lançamento existe no banco."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AccountPicker accounts={accounts.map((item) => ({ id: item.id, name: item.name }))} value={account.id} />
            {canWrite ? <StatementImportButton accountId={account.id} accountName={account.name} /> : null}
          </div>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Saldo no sistema hoje"
          value={formatCurrency(summary.ledger_balance)}
          hint="Saldo inicial + movimentos lançados nesta conta"
        />
        <MetricCard
          label="Saldo do extrato"
          value={summary.statement_balance === null ? "—" : formatCurrency(summary.statement_balance)}
          hint={summary.statement_balance_date ? `Em ${formatDate(summary.statement_balance_date)}` : "Informe o saldo final ao importar"}
        />
        <MetricCard
          label="Diferença"
          value={difference === null ? "—" : formatCurrency(difference)}
          hint={
            difference === null
              ? "Sem saldo de extrato para comparar"
              : reconciled
                ? "Conta conciliada"
                : `Extrato − sistema em ${formatDate(summary.statement_balance_date!)}`
          }
          formula="Saldo do extrato na data informada menos o saldo do sistema na mesma data. Zero = tudo que está no banco está lançado."
          className={difference !== null && Math.abs(difference) >= 0.005 ? "border-warning/40" : undefined}
        />
        <MetricCard
          label="Linhas pendentes"
          value={String(summary.pending_lines)}
          hint={`${formatCurrency(summary.pending_in)} em entradas · ${formatCurrency(summary.pending_out)} em saídas`}
        />
      </div>

      {summary.matched_lines + summary.pending_lines + summary.ignored_lines > 0 && reconciled ? (
        <Callout tone="positive" className="mb-5">
          Tudo conciliado: o saldo do extrato bate com o sistema e não há linhas pendentes.
        </Callout>
      ) : null}

      <ReconciliationBoard
        accountId={account.id}
        lines={lines}
        status={status}
        lookups={lookups}
        canWrite={canWrite}
        suggestionCount={summary.suggestions}
        unmatchedMovements={unmatched}
      />

      {imports.length ? (
        <section className="mt-5">
          <p className="mb-2 label-caption">Últimas importações</p>
          <ul className="surface-card divide-y divide-border text-[12.5px]">
            {imports.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="font-medium">{item.file_name}</span>
                <span className="text-muted">
                  {item.period_start ? `${formatDate(item.period_start)} a ${formatDate(item.period_end ?? item.period_start)} · ` : ""}
                  {item.lines_inserted} nova(s)
                  {item.lines_duplicated ? `, ${item.lines_duplicated} já existiam` : ""} · {formatDateTime(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
