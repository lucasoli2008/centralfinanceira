import { PageHeader } from "@/components/layout/page-header";
import { requireFinance } from "@/lib/auth/session";
import { financeCan } from "@/lib/finance/permissions";
import { formatCurrency } from "@/lib/formatting/number";
import {
  getFinEntryDetail,
  getFinLookups,
  getFinSummary,
  getSignedFinAttachmentUrl,
  listFinAccounts,
  listFinEntries,
  type FinEntryFilters,
} from "@/server/queries/finance";
import { FIN_NATURES } from "@/lib/validation/finance";
import { MetricCard } from "@/components/finance/metric-card";
import { EntriesTable } from "./entries-table";
import { ExportLinks } from "./export-links";
import { EntryDetailHost } from "./entry-detail-host";
import { FinanceFilters } from "./finance-filters";
import { financeYears, resolveFinanceFilters, validUuid, type FinanceSearchParams } from "./filters";
import type { FinEntryKind, FinEntryStatus, FinNature } from "@/types/database";

type Mode = "ledger" | "payables" | "receivables";

const PAGE_SIZE = 50;

const COPY: Record<Mode, { title: string; description: string }> = {
  ledger: {
    title: "Lançamentos",
    description: "Todas as entradas, saídas, transferências e ajustes. Clique em um lançamento para ver baixas, comprovantes e histórico.",
  },
  payables: {
    title: "Contas a pagar",
    description: "Obrigações da imobiliária e repasses a terceiros. Uma conta só sai daqui quando o pagamento é registrado — previsto não é realizado.",
  },
  receivables: {
    title: "Contas a receber",
    description: "Comissões, taxas e demais valores a receber. Pagamentos parciais ficam registrados até a quitação.",
  },
};

export async function FinanceEntriesPage({ mode, searchParams }: { mode: Mode; searchParams: FinanceSearchParams }) {
  const context = await requireFinance("view");
  const canWrite = financeCan(context.financeRole, "write");
  const page = Math.max(1, Number(searchParams.pagina) || 1);
  const defaultStatus = mode === "ledger" ? "" : "pending";
  const rawStatus = searchParams.status ?? defaultStatus;
  const status = rawStatus === "todos" ? null : (rawStatus || null);
  const kind = (["income", "expense", "transfer", "adjustment"] as const).includes(searchParams.tipo as FinEntryKind)
    ? (searchParams.tipo as FinEntryKind)
    : null;
  const nature = (FIN_NATURES as readonly string[]).includes(searchParams.natureza ?? "") ? (searchParams.natureza as FinNature) : null;

  // A pagar/receber mostra tudo que está pendente, independentemente do período,
  // a menos que o usuário escolha um período explicitamente.
  const { filters, period } = resolveFinanceFilters(searchParams);
  const operationId = validUuid(searchParams.operacao);
  const usePeriod = !operationId && (mode === "ledger" || Boolean(searchParams.periodo));

  const entryFilters: FinEntryFilters = {
    view: mode === "payables" ? "payables" : mode === "receivables" ? "receivables" : "all",
    from: usePeriod ? period.from : null,
    to: usePeriod ? period.to : null,
    dateField: mode === "ledger" ? "competence_date" : "reference_date",
    kind,
    status: status as FinEntryStatus | "overdue" | "pending" | null,
    categoryId: validUuid(searchParams.categoria),
    accountId: validUuid(searchParams.conta),
    counterpartyId: validUuid(searchParams.favorecido),
    nature,
    search: searchParams.busca ?? null,
    operationId,
    includeCancelled: status === "cancelled" || Boolean(operationId),
  };

  const detailId = validUuid(searchParams.lancamento);

  const [{ rows, total }, lookups, allAccounts, summary, detail] = await Promise.all([
    listFinEntries(entryFilters, { page, pageSize: PAGE_SIZE }),
    getFinLookups(),
    listFinAccounts(),
    mode === "ledger" ? Promise.resolve(null) : getFinSummary(filters),
    detailId ? getFinEntryDetail(detailId) : Promise.resolve(null),
  ]);

  const attachments = detail
    ? await Promise.all(
        detail.attachments.map(async (attachment) => ({
          ...attachment,
          url: await getSignedFinAttachmentUrl(attachment.storage_path),
        })),
      )
    : [];

  const copy = COPY[mode];

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          mode === "ledger" ? (
            <ExportLinks
              tipo="lancamentos"
              pdf={false}
              params={{ periodo: searchParams.periodo, ano: searchParams.ano, mes: searchParams.mes, de: searchParams.de, ate: searchParams.ate }}
            />
          ) : null
        }
      />

      <FinanceFilters
        years={financeYears()}
        accounts={allAccounts}
        categories={lookups.categories}
        showRegime={false}
      />

      {summary && mode === "payables" ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <MetricCard label="Contas a pagar da imobiliária" value={formatCurrency(summary.payables_open)} hint="Fornecedores, despesas e impostos em aberto" />
          <MetricCard
            label="Vencidas"
            value={formatCurrency(summary.payables_overdue)}
            hint={summary.payables_overdue > 0 ? "Exigem atenção imediata" : "Nada vencido"}
            className={summary.payables_overdue > 0 ? "border-danger/30" : undefined}
          />
          <MetricCard
            label="Repasses a terceiros"
            value={formatCurrency(summary.third_party_obligations)}
            hint="Proprietários e corretores — dinheiro que não é da imobiliária"
          />
        </div>
      ) : null}

      {summary && mode === "receivables" ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <MetricCard label="Total a receber" value={formatCurrency(summary.receivables_open)} hint="Títulos em aberto e parciais" />
          <MetricCard
            label="Em atraso"
            value={formatCurrency(summary.receivables_overdue)}
            hint={summary.receivables_overdue > 0 ? "Recebíveis com vencimento passado" : "Nenhum atraso"}
            className={summary.receivables_overdue > 0 ? "border-warning/40" : undefined}
          />
          <MetricCard
            label="Comissões fora do caixa"
            value={formatCurrency(summary.commissions_not_in_cash)}
            hint={`${summary.commissions_not_in_cash_count} comissões registradas no período ainda sem entrada no caixa`}
          />
        </div>
      ) : null}

      <EntriesTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        lookups={lookups}
        canWrite={canWrite}
        mode={mode}
        defaultStatus={defaultStatus}
        newKind={mode === "receivables" ? "income" : "expense"}
      />

      {detail ? <EntryDetailHost detail={detail} attachments={attachments} lookups={lookups} canWrite={canWrite} /> : null}
    </>
  );
}
