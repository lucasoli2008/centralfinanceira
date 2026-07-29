import { notFound } from "next/navigation";
import Link from "next/link";
import { Copy, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EntryForm } from "./entry-form";
import { EntryDetailActions } from "./entry-detail-actions";
import { requireAppContext } from "@/lib/auth/session";
import { getEntryDetail, getMonthClosing } from "@/server/queries/entries";
import { listBrokers } from "@/server/queries/brokers";
import { getBroker } from "@/server/queries/brokers";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate, formatDateTime, formatMonthYear } from "@/lib/formatting/date";
import {
  AMOUNT_MODE_LABELS,
  ENTRY_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  baseAmountShortLabel,
} from "@/lib/formatting/labels";
import type { EntryType } from "@/lib/finance/types";
import type { EntryFormValues } from "@/lib/validation/entry";
import type { BrokerRow } from "@/types/database";

function basePath(entryType: EntryType) {
  return entryType === "sale" ? "/vendas" : "/locacoes";
}

async function isMonthClosed(entryDate: string, enabled: boolean) {
  if (!enabled) return false;
  const [year, month] = entryDate.split("-").map(Number);
  const closing = await getMonthClosing(year, month);
  return closing?.status === "closed";
}

/** Página de novo lançamento, com suporte a duplicação. */
export async function NewEntryPage({
  entryType,
  duplicateFrom,
}: {
  entryType: EntryType;
  duplicateFrom?: string;
}) {
  const context = await requireAppContext();
  const brokers = await listBrokers();

  let defaultValues: Partial<EntryFormValues> | undefined;
  let extraBrokers: BrokerRow[] = [];

  if (duplicateFrom) {
    const detail = await getEntryDetail(duplicateFrom);
    if (detail) {
      defaultValues = {
        entryType,
        entryDate: new Date().toISOString().slice(0, 10),
        description: detail.entry.description,
        reference: detail.entry.reference ?? "",
        propertyType: detail.entry.property_type,
        baseAmount: detail.entry.base_amount,
        commissionMode: detail.entry.commission_mode,
        commissionRate: detail.entry.commission_rate ?? undefined,
        commissionFixedAmount: detail.entry.commission_fixed_amount ?? undefined,
        notes: detail.entry.notes ?? "",
        splits: detail.splits.map((split) => ({
          brokerId: split.broker_id,
          splitMode: split.split_mode,
          splitRate: split.split_rate,
          splitFixedAmount: split.split_fixed_amount,
        })),
      };

      extraBrokers = (
        await Promise.all(detail.splits.map((split) => getBroker(split.broker_id)))
      ).filter((broker): broker is BrokerRow => Boolean(broker));
    }
  }

  const isSale = entryType === "sale";

  return (
    <>
      <PageHeader
        title={isSale ? "Nova venda" : "Nova locação"}
        description={
          isSale
            ? "Registre a comissão recebida na venda. O mês financeiro vem da data da entrada."
            : "Registre a comissão da entrada da locação, referente ao primeiro aluguel."
        }
        backHref={basePath(entryType)}
        backLabel={isSale ? "Vendas" : "Locações"}
      />

      <EntryForm
        entryType={entryType}
        brokers={brokers}
        extraBrokers={extraBrokers}
        settings={context.settings}
        defaultValues={defaultValues}
      />
    </>
  );
}

/** Página de edição. */
export async function EditEntryPage({
  entryType,
  entryId,
}: {
  entryType: EntryType;
  entryId: string;
}) {
  const context = await requireAppContext();
  const detail = await getEntryDetail(entryId);

  if (!detail || detail.entry.deleted_at) notFound();

  const brokers = await listBrokers();
  const extraBrokers = (
    await Promise.all(detail.splits.map((split) => getBroker(split.broker_id)))
  ).filter((broker): broker is BrokerRow => Boolean(broker));

  const monthClosed = await isMonthClosed(
    detail.entry.entry_date,
    context.settings.monthly_closing_enabled,
  );

  return (
    <>
      <PageHeader
        title="Editar lançamento"
        description={detail.entry.description}
        backHref={`${basePath(entryType)}/${entryId}`}
        backLabel="Detalhes do lançamento"
      />

      <EntryForm
        entryType={entryType}
        entryId={entryId}
        brokers={brokers}
        extraBrokers={extraBrokers}
        settings={context.settings}
        monthClosed={monthClosed}
        defaultValues={{
          entryType: detail.entry.entry_type,
          entryDate: detail.entry.entry_date,
          description: detail.entry.description,
          reference: detail.entry.reference ?? "",
          propertyType: detail.entry.property_type,
          baseAmount: detail.entry.base_amount,
          commissionMode: detail.entry.commission_mode,
          commissionRate: detail.entry.commission_rate ?? undefined,
          commissionFixedAmount: detail.entry.commission_fixed_amount ?? undefined,
          notes: detail.entry.notes ?? "",
          exceptionConfirmed: detail.entry.exception_confirmed,
          exceptionReason: detail.entry.exception_reason ?? "",
          splits: detail.splits.map((split) => ({
            brokerId: split.broker_id,
            splitMode: split.split_mode,
            splitRate: split.split_rate,
            splitFixedAmount: split.split_fixed_amount,
          })),
        }}
      />
    </>
  );
}

/** Página de detalhe (somente leitura). */
export async function EntryDetailPage({
  entryType,
  entryId,
}: {
  entryType: EntryType;
  entryId: string;
}) {
  const context = await requireAppContext();
  const detail = await getEntryDetail(entryId);

  if (!detail) notFound();

  const { entry, splits } = detail;
  const [year, month] = entry.entry_date.split("-").map(Number);
  const monthClosed = await isMonthClosed(
    entry.entry_date,
    context.settings.monthly_closing_enabled,
  );

  const facts = [
    { label: "Data da entrada", value: formatDate(entry.entry_date) },
    { label: "Mês financeiro", value: formatMonthYear(year, month) },
    { label: "Tipo de entrada", value: ENTRY_TYPE_LABELS[entry.entry_type] },
    { label: "Tipo do imóvel", value: PROPERTY_TYPE_LABELS[entry.property_type] },
    { label: "Referência", value: entry.reference ?? "—" },
    { label: baseAmountShortLabel(entry.entry_type), value: formatCurrency(entry.base_amount) },
    {
      label: "Forma da comissão",
      value:
        entry.commission_mode === "percentage"
          ? `${AMOUNT_MODE_LABELS.percentage} · ${formatPercent(entry.commission_rate)}`
          : `${AMOUNT_MODE_LABELS.fixed} · ${formatCurrency(entry.commission_fixed_amount)}`,
    },
    { label: "Criado por", value: detail.createdByName ?? "—" },
    { label: "Criado em", value: formatDateTime(entry.created_at) },
    { label: "Última atualização", value: formatDateTime(entry.updated_at) },
  ];

  return (
    <>
      <PageHeader
        title={entry.description}
        description={`${ENTRY_TYPE_LABELS[entry.entry_type]} · ${formatDate(entry.entry_date)}`}
        backHref={basePath(entryType)}
        backLabel={entryType === "sale" ? "Vendas" : "Locações"}
        actions={
          entry.deleted_at ? (
            <Badge tone="danger">Excluído</Badge>
          ) : (
            <>
              <Button asChild variant="secondary">
                <Link href={`${basePath(entryType)}/nova?duplicar=${entry.entry_id}`}>
                  <Copy />
                  Duplicar
                </Link>
              </Button>
              <Button asChild>
                <Link href={`${basePath(entryType)}/${entry.entry_id}/editar`}>
                  <Pencil />
                  Editar
                </Link>
              </Button>
              <EntryDetailActions entryId={entry.entry_id} entryType={entryType} />
            </>
          )
        }
      />

      {monthClosed ? (
        <p className="mb-6 rounded-card border border-warning bg-warning-soft px-4 py-3 text-[13px] text-warning">
          Este mês financeiro está fechado. Reabra o mês antes de realizar alterações.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="surface-card p-5">
            <h2 className="section-title">Informações</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="label-caption">{fact.label}</dt>
                  <dd className="mt-0.5 text-[13px]">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {entry.notes ? (
              <div className="mt-5 border-t border-border pt-4">
                <h3 className="label-caption">Observações</h3>
                <p className="mt-1 whitespace-pre-line text-[13px]">{entry.notes}</p>
              </div>
            ) : null}

            {entry.exception_confirmed ? (
              <div className="mt-5 rounded-control bg-danger-soft px-4 py-3">
                <p className="text-[13px] font-medium text-danger">
                  Exceção financeira confirmada
                </p>
                <p className="mt-1 text-[13px] text-danger">{entry.exception_reason}</p>
              </div>
            ) : null}
          </section>

          <section className="surface-card p-5">
            <h2 className="section-title">Corretores e repasses</h2>

            {splits.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted">
                Nenhum corretor participou desta operação. Toda a comissão ficou com a imobiliária.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {splits.map((split) => (
                  <li key={split.split_id} className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <p className="text-[13px] font-medium">
                        {split.broker_name}
                        {split.broker_is_active ? null : (
                          <Badge tone="neutral" className="ml-2">
                            Inativo
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {split.split_mode === "percentage"
                          ? `${formatPercent(split.split_rate)} da comissão bruta`
                          : "Valor fixo negociado"}
                      </p>
                    </div>
                    <p className="text-[13px] font-semibold tabular">
                      {formatCurrency(split.payout_amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="surface-card h-fit p-5 lg:sticky lg:top-20">
          <h2 className="section-title">Resultado</h2>
          <dl className="mt-4 space-y-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-muted">Comissão bruta</dt>
              <dd className="text-[13px] font-medium tabular">
                {formatCurrency(entry.gross_commission)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-muted">Total de repasses</dt>
              <dd className="text-[13px] font-medium tabular">
                − {formatCurrency(entry.total_broker_payout)}
              </dd>
            </div>
            <div className="border-t border-border pt-3">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[13px] font-medium">Receita líquida</dt>
                <dd
                  className={`text-lg font-semibold tabular ${
                    entry.net_company_revenue < 0 ? "text-danger" : "text-accent"
                  }`}
                >
                  {formatCurrency(entry.net_company_revenue)}
                </dd>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <dt className="text-xs text-muted">Margem líquida</dt>
                <dd className="text-xs tabular text-muted">
                  {entry.net_margin === null ? "Sem base para cálculo" : formatPercent(entry.net_margin)}
                </dd>
              </div>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
