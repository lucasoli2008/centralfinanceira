import "server-only";

import * as React from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatCurrency, formatDecimal, formatInteger, formatPercent } from "@/lib/formatting/number";
import { formatDate, formatDateTime, formatMonthYear, monthName } from "@/lib/formatting/date";
import {
  ENTRY_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  WORK_ATTACHMENT_CATEGORY_LABELS,
  WORK_CATEGORY_LABELS,
  WORK_ENTRY_UNIT_LABELS,
  WORK_PRIORITY_LABELS,
  WORK_STATUS_LABELS,
} from "@/lib/formatting/labels";
import type {
  BrokerRankingRow,
  BrokerStatementRow,
  EntryTotalsRow,
  MonthlySeriesRow,
  SummaryRow,
  WorkAttachmentCategory,
  WorkEntryRow,
  WorkEntryType,
  WorkRow,
} from "@/types/database";
import type { WorkTotals } from "@/lib/works/types";

/**
 * Relatórios em PDF gerados no servidor (nunca captura de tela).
 * Todos os números vêm das mesmas funções de consulta usadas pelas telas —
 * dashboard, tabelas e PDFs precisam bater exatamente.
 */

export interface ReportBranding {
  organizationName: string;
  logoUrl: string | null;
  accentColor: string;
  header: string | null;
  footer: string | null;
  generatedBy: string;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontSize: 9,
    color: "#1c1917",
    fontFamily: "Helvetica",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5e4",
    paddingBottom: 10,
    marginBottom: 14,
  },
  logo: { width: 34, height: 34, objectFit: "contain", marginRight: 10 },
  organization: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  headerCaption: { fontSize: 8, color: "#57534e", marginTop: 2 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#57534e" },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
  },
  cardsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    width: "23.5%",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    borderRadius: 6,
    padding: 8,
  },
  cardLabel: { fontSize: 7, color: "#57534e", marginBottom: 3 },
  cardValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  table: { borderWidth: 1, borderColor: "#e7e5e4", borderRadius: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#fafaf9",
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5e4",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#f0efee",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableFooter: {
    flexDirection: "row",
    backgroundColor: "#fafaf9",
    borderTopWidth: 1,
    borderTopColor: "#d6d3d1",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#57534e" },
  td: { fontSize: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  right: { textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e7e5e4",
    paddingTop: 6,
    fontSize: 7,
    color: "#8a8580",
  },
  filterLine: { fontSize: 8, color: "#57534e", marginBottom: 2 },
  emptyMessage: { fontSize: 9, color: "#57534e", paddingVertical: 12, textAlign: "center" },
});

function Header({ branding, title, subtitle }: { branding: ReportBranding; title: string; subtitle: string }) {
  return (
    <>
      <View style={styles.headerRow} fixed>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Image do @react-pdf/renderer, não <img> — não aceita (nem precisa de) alt. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
          <View>
            <Text style={styles.organization}>{branding.organizationName}</Text>
            <Text style={styles.headerCaption}>
              {branding.header ?? "Central Financeira"}
            </Text>
          </View>
        </View>
        <View>
          <Text style={[styles.headerCaption, styles.right]}>
            Gerado em {formatDateTime(new Date())}
          </Text>
          <Text style={[styles.headerCaption, styles.right]}>Por {branding.generatedBy}</Text>
        </View>
      </View>

      <View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </>
  );
}

function Footer({ branding }: { branding: ReportBranding }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{branding.footer ?? `${branding.organizationName} · Documento confidencial`}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function SummaryCards({ summary, accentColor }: { summary: SummaryRow; accentColor: string }) {
  const cards = [
    { label: "Receita líquida", value: formatCurrency(summary.total_net_revenue), accent: true },
    { label: "Comissão bruta total", value: formatCurrency(summary.total_gross_commission) },
    { label: "Repasses aos corretores", value: formatCurrency(summary.total_broker_payout) },
    { label: "Entradas", value: formatInteger(summary.entries_count) },
    { label: "Comissão de vendas", value: formatCurrency(summary.sales_gross_commission) },
    { label: "Comissão de locações", value: formatCurrency(summary.rental_gross_commission) },
    {
      label: "Ticket médio",
      value:
        summary.average_gross_commission === null
          ? "—"
          : formatCurrency(summary.average_gross_commission),
    },
    {
      label: "Margem líquida",
      value: summary.net_margin === null ? "Sem base" : formatPercent(summary.net_margin),
    },
  ];

  return (
    <View style={styles.cardsRow}>
      {cards.map((card) => (
        <View
          key={card.label}
          style={[styles.card, card.accent ? { borderColor: accentColor } : {}]}
        >
          <Text style={styles.cardLabel}>{card.label}</Text>
          <Text style={[styles.cardValue, card.accent ? { color: accentColor } : {}]}>
            {card.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const ENTRY_COLUMNS: { key: string; label: string; width: string; numeric?: boolean }[] = [
  { key: "date", label: "Data", width: "9%" },
  { key: "type", label: "Tipo", width: "9%" },
  { key: "description", label: "Descrição", width: "26%" },
  { key: "property", label: "Imóvel", width: "10%" },
  { key: "base", label: "Valor-base", width: "12%", numeric: true },
  { key: "gross", label: "Comissão bruta", width: "12%", numeric: true },
  { key: "payout", label: "Repasses", width: "11%", numeric: true },
  { key: "net", label: "Receita líquida", width: "11%", numeric: true },
];

function EntriesTable({ entries, summary }: { entries: EntryTotalsRow[]; summary: SummaryRow }) {
  if (entries.length === 0) {
    return <Text style={styles.emptyMessage}>Nenhum lançamento no período selecionado.</Text>;
  }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeader} fixed>
        {ENTRY_COLUMNS.map((column) => (
          <Text
            key={column.key}
            style={[styles.th, { width: column.width }, column.numeric ? styles.right : {}]}
          >
            {column.label}
          </Text>
        ))}
      </View>

      {entries.map((entry) => (
        <View key={entry.entry_id} style={styles.tableRow} wrap={false}>
          <Text style={[styles.td, { width: "9%" }]}>{formatDate(entry.entry_date)}</Text>
          <Text style={[styles.td, { width: "9%" }]}>{ENTRY_TYPE_LABELS[entry.entry_type]}</Text>
          <Text style={[styles.td, { width: "26%" }]}>{entry.description}</Text>
          <Text style={[styles.td, { width: "10%" }]}>
            {PROPERTY_TYPE_LABELS[entry.property_type]}
          </Text>
          <Text style={[styles.td, styles.right, { width: "12%" }]}>
            {formatCurrency(entry.base_amount)}
          </Text>
          <Text style={[styles.td, styles.right, { width: "12%" }]}>
            {formatCurrency(entry.gross_commission)}
          </Text>
          <Text style={[styles.td, styles.right, { width: "11%" }]}>
            {formatCurrency(entry.total_broker_payout)}
          </Text>
          <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
            {formatCurrency(entry.net_company_revenue)}
          </Text>
        </View>
      ))}

      <View style={styles.tableFooter}>
        <Text style={[styles.td, styles.bold, { width: "54%" }]}>Total</Text>
        <Text style={[styles.td, styles.right, styles.bold, { width: "12%" }]}>
          {formatCurrency(summary.sales_base_amount + summary.rental_base_amount)}
        </Text>
        <Text style={[styles.td, styles.right, styles.bold, { width: "12%" }]}>
          {formatCurrency(summary.total_gross_commission)}
        </Text>
        <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
          {formatCurrency(summary.total_broker_payout)}
        </Text>
        <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
          {formatCurrency(summary.total_net_revenue)}
        </Text>
      </View>
    </View>
  );
}

function BrokerTable({ ranking }: { ranking: BrokerRankingRow[] }) {
  if (ranking.length === 0) {
    return <Text style={styles.emptyMessage}>Nenhum repasse a corretores no período.</Text>;
  }

  const total = ranking.reduce((sum, row) => sum + Number(row.total_payout), 0);

  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: "34%" }]}>Corretor</Text>
        <Text style={[styles.th, styles.right, { width: "13%" }]}>Participações</Text>
        <Text style={[styles.th, styles.right, { width: "18%" }]}>Total de repasses</Text>
        <Text style={[styles.th, styles.right, { width: "17%" }]}>Média por operação</Text>
        <Text style={[styles.th, styles.right, { width: "18%" }]}>Volume das operações</Text>
      </View>

      {ranking.map((row) => (
        <View key={row.broker_id} style={styles.tableRow} wrap={false}>
          <Text style={[styles.td, { width: "34%" }]}>{row.broker_name}</Text>
          <Text style={[styles.td, styles.right, { width: "13%" }]}>
            {formatInteger(row.participations)}
          </Text>
          <Text style={[styles.td, styles.right, styles.bold, { width: "18%" }]}>
            {formatCurrency(row.total_payout)}
          </Text>
          <Text style={[styles.td, styles.right, { width: "17%" }]}>
            {formatCurrency(row.average_payout)}
          </Text>
          <Text style={[styles.td, styles.right, { width: "18%" }]}>
            {formatCurrency(row.participated_base_amount)}
          </Text>
        </View>
      ))}

      <View style={styles.tableFooter}>
        <Text style={[styles.td, styles.bold, { width: "47%" }]}>Total repassado</Text>
        <Text style={[styles.td, styles.right, styles.bold, { width: "18%" }]}>
          {formatCurrency(total)}
        </Text>
        <Text style={[styles.td, { width: "35%" }]} />
      </View>
    </View>
  );
}

/** Barras horizontais simples — legíveis na impressão, sem depender de imagens. */
function MonthlyBars({ series }: { series: MonthlySeriesRow[] }) {
  const max = Math.max(...series.map((row) => Number(row.total_gross_commission)), 1);

  return (
    <View style={{ marginTop: 4 }}>
      {series.map((row) => {
        const gross = Number(row.total_gross_commission);
        const net = Number(row.total_net_revenue);
        const grossWidth = Math.max((gross / max) * 100, 0);
        const netWidth = Math.max((net / max) * 100, 0);

        return (
          <View key={row.period_key} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
            <Text style={[styles.td, { width: "14%" }]}>{monthName(row.month)}</Text>
            <View style={{ width: "56%" }}>
              <View
                style={{
                  height: 6,
                  width: `${grossWidth}%`,
                  backgroundColor: "#d6d3d1",
                  borderRadius: 2,
                  marginBottom: 2,
                }}
              />
              <View
                style={{
                  height: 6,
                  width: `${netWidth}%`,
                  backgroundColor: "#0f5132",
                  borderRadius: 2,
                }}
              />
            </View>
            <Text style={[styles.td, styles.right, { width: "15%" }]}>{formatCurrency(gross)}</Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "15%" }]}>
              {formatCurrency(net)}
            </Text>
          </View>
        );
      })}
      <Text style={[styles.cardLabel, { marginTop: 4 }]}>
        Barra clara: comissão bruta · Barra escura: receita líquida
      </Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Documentos
// -----------------------------------------------------------------------------

export interface MonthlyReportData {
  branding: ReportBranding;
  year: number;
  month: number;
  summary: SummaryRow;
  previousSummary: SummaryRow;
  entries: EntryTotalsRow[];
  ranking: BrokerRankingRow[];
}

function MonthlyReport({ data }: { data: MonthlyReportData }) {
  const { branding, summary, previousSummary } = data;
  const variation =
    previousSummary.total_net_revenue === 0
      ? null
      : ((summary.total_net_revenue - previousSummary.total_net_revenue) /
          Math.abs(previousSummary.total_net_revenue)) *
        100;

  return (
    <Document title={`Relatório mensal ${formatMonthYear(data.year, data.month)}`}>
      <Page size="A4" style={styles.page}>
        <Header
          branding={branding}
          title={`Relatório mensal · ${formatMonthYear(data.year, data.month)}`}
          subtitle="Comissões recebidas no regime de caixa, conforme a data da entrada."
        />

        <Text style={styles.sectionTitle}>Resumo do mês</Text>
        <SummaryCards summary={summary} accentColor={branding.accentColor} />

        <Text style={styles.sectionTitle}>Comparação com o mês anterior</Text>
        <Text style={styles.filterLine}>
          Receita líquida anterior: {formatCurrency(previousSummary.total_net_revenue)} ·{" "}
          {variation === null
            ? "Sem período anterior para comparação"
            : `Variação: ${variation > 0 ? "+" : ""}${variation.toFixed(1)}%`}
        </Text>
        <Text style={styles.filterLine}>
          Vendas: {formatInteger(summary.sales_count)} · Locações:{" "}
          {formatInteger(summary.rental_count)}
        </Text>

        <Text style={styles.sectionTitle}>Lançamentos do mês</Text>
        <EntriesTable entries={data.entries} summary={summary} />

        <Text style={styles.sectionTitle}>Resumo por corretor</Text>
        <BrokerTable ranking={data.ranking} />

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

export interface AnnualReportData {
  branding: ReportBranding;
  year: number;
  summary: SummaryRow;
  previousSummary: SummaryRow;
  series: MonthlySeriesRow[];
  ranking: BrokerRankingRow[];
}

function AnnualReport({ data }: { data: AnnualReportData }) {
  const { branding, summary, series } = data;

  return (
    <Document title={`Relatório anual ${data.year}`}>
      <Page size="A4" style={styles.page}>
        <Header
          branding={branding}
          title={`Relatório anual · ${data.year}`}
          subtitle="Consolidação dos 12 meses, com vendas e locações separadas."
        />

        <Text style={styles.sectionTitle}>Resumo do ano</Text>
        <SummaryCards summary={summary} accentColor={branding.accentColor} />

        <Text style={styles.sectionTitle}>Comparação com {data.year - 1}</Text>
        <Text style={styles.filterLine}>
          Receita líquida em {data.year - 1}: {formatCurrency(data.previousSummary.total_net_revenue)}
        </Text>
        <Text style={styles.filterLine}>
          Comissão bruta em {data.year - 1}:{" "}
          {formatCurrency(data.previousSummary.total_gross_commission)}
        </Text>

        <Text style={styles.sectionTitle}>Resultado mês a mês</Text>
        <MonthlyBars series={series} />

        <Text style={styles.sectionTitle}>Tabela mensal consolidada</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { width: "16%" }]}>Mês</Text>
            <Text style={[styles.th, styles.right, { width: "17%" }]}>Comissão bruta</Text>
            <Text style={[styles.th, styles.right, { width: "17%" }]}>Repasses</Text>
            <Text style={[styles.th, styles.right, { width: "17%" }]}>Receita líquida</Text>
            <Text style={[styles.th, styles.right, { width: "11%" }]}>Vendas</Text>
            <Text style={[styles.th, styles.right, { width: "11%" }]}>Locações</Text>
            <Text style={[styles.th, styles.right, { width: "11%" }]}>Entradas</Text>
          </View>

          {series.map((row) => (
            <View key={row.period_key} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, { width: "16%" }]}>{monthName(row.month)}</Text>
              <Text style={[styles.td, styles.right, { width: "17%" }]}>
                {formatCurrency(row.total_gross_commission)}
              </Text>
              <Text style={[styles.td, styles.right, { width: "17%" }]}>
                {formatCurrency(row.total_broker_payout)}
              </Text>
              <Text style={[styles.td, styles.right, styles.bold, { width: "17%" }]}>
                {formatCurrency(row.total_net_revenue)}
              </Text>
              <Text style={[styles.td, styles.right, { width: "11%" }]}>
                {formatInteger(row.sales_count)}
              </Text>
              <Text style={[styles.td, styles.right, { width: "11%" }]}>
                {formatInteger(row.rental_count)}
              </Text>
              <Text style={[styles.td, styles.right, { width: "11%" }]}>
                {formatInteger(row.entries_count)}
              </Text>
            </View>
          ))}

          <View style={styles.tableFooter}>
            <Text style={[styles.td, styles.bold, { width: "16%" }]}>Total</Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "17%" }]}>
              {formatCurrency(summary.total_gross_commission)}
            </Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "17%" }]}>
              {formatCurrency(summary.total_broker_payout)}
            </Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "17%" }]}>
              {formatCurrency(summary.total_net_revenue)}
            </Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
              {formatInteger(summary.sales_count)}
            </Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
              {formatInteger(summary.rental_count)}
            </Text>
            <Text style={[styles.td, styles.right, styles.bold, { width: "11%" }]}>
              {formatInteger(summary.entries_count)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ranking anual de corretores</Text>
        <BrokerTable ranking={data.ranking} />

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

export interface BrokerReportData {
  branding: ReportBranding;
  brokerName: string;
  periodLabel: string;
  statement: BrokerStatementRow[];
  totalPayout: number;
  averagePayout: number;
}

function BrokerReport({ data }: { data: BrokerReportData }) {
  const { branding } = data;

  return (
    <Document title={`Relatório do corretor ${data.brokerName}`}>
      <Page size="A4" style={styles.page}>
        <Header
          branding={branding}
          title={`Relatório por corretor · ${data.brokerName}`}
          subtitle={data.periodLabel}
        />

        <View style={[styles.cardsRow, { marginTop: 12 }]}>
          <View style={[styles.card, { borderColor: branding.accentColor }]}>
            <Text style={styles.cardLabel}>Total de repasses</Text>
            <Text style={[styles.cardValue, { color: branding.accentColor }]}>
              {formatCurrency(data.totalPayout)}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Participações</Text>
            <Text style={styles.cardValue}>{formatInteger(data.statement.length)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Média por operação</Text>
            <Text style={styles.cardValue}>{formatCurrency(data.averagePayout)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Entradas em que participou</Text>

        {data.statement.length === 0 ? (
          <Text style={styles.emptyMessage}>Nenhuma participação no período.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={[styles.th, { width: "10%" }]}>Data</Text>
              <Text style={[styles.th, { width: "10%" }]}>Tipo</Text>
              <Text style={[styles.th, { width: "30%" }]}>Descrição</Text>
              <Text style={[styles.th, styles.right, { width: "15%" }]}>Comissão bruta</Text>
              <Text style={[styles.th, styles.right, { width: "17%" }]}>Repasse aplicado</Text>
              <Text style={[styles.th, styles.right, { width: "18%" }]}>Valor recebido</Text>
            </View>

            {data.statement.map((row) => (
              <View key={row.entry_id} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, { width: "10%" }]}>{formatDate(row.entry_date)}</Text>
                <Text style={[styles.td, { width: "10%" }]}>
                  {ENTRY_TYPE_LABELS[row.entry_type]}
                </Text>
                <Text style={[styles.td, { width: "30%" }]}>{row.description}</Text>
                <Text style={[styles.td, styles.right, { width: "15%" }]}>
                  {formatCurrency(row.gross_commission)}
                </Text>
                <Text style={[styles.td, styles.right, { width: "17%" }]}>
                  {row.split_mode === "percentage"
                    ? formatPercent(row.split_rate)
                    : `Fixo · ${formatCurrency(row.split_fixed_amount)}`}
                </Text>
                <Text style={[styles.td, styles.right, styles.bold, { width: "18%" }]}>
                  {formatCurrency(row.payout_amount)}
                </Text>
              </View>
            ))}

            <View style={styles.tableFooter}>
              <Text style={[styles.td, styles.bold, { width: "82%" }]}>Total recebido</Text>
              <Text style={[styles.td, styles.right, styles.bold, { width: "18%" }]}>
                {formatCurrency(data.totalPayout)}
              </Text>
            </View>
          </View>
        )}

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

export interface FilteredReportData {
  branding: ReportBranding;
  periodLabel: string;
  filters: string[];
  summary: SummaryRow;
  entries: EntryTotalsRow[];
  ranking: BrokerRankingRow[];
}

function FilteredReport({ data }: { data: FilteredReportData }) {
  const { branding } = data;

  return (
    <Document title="Relatório filtrado">
      <Page size="A4" style={styles.page} orientation="landscape">
        <Header
          branding={branding}
          title="Relatório de lançamentos"
          subtitle={data.periodLabel}
        />

        <Text style={styles.sectionTitle}>Filtros aplicados</Text>
        {data.filters.map((filter) => (
          <Text key={filter} style={styles.filterLine}>
            • {filter}
          </Text>
        ))}

        <Text style={styles.sectionTitle}>Resumo</Text>
        <SummaryCards summary={data.summary} accentColor={branding.accentColor} />

        <Text style={styles.sectionTitle}>Lançamentos</Text>
        <EntriesTable entries={data.entries} summary={data.summary} />

        <Text style={styles.sectionTitle}>Resumo por corretor</Text>
        <BrokerTable ranking={data.ranking} />

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------------------
// Obras
// -----------------------------------------------------------------------------

const WORK_ENTRY_COLUMNS: { key: string; label: string; width: string; numeric?: boolean }[] = [
  { key: "date", label: "Data", width: "12%" },
  { key: "description", label: "Descrição", width: "28%" },
  { key: "supplier", label: "Fornecedor", width: "20%" },
  { key: "quantity", label: "Qtd.", width: "14%", numeric: true },
  { key: "unitPrice", label: "Valor unit.", width: "13%", numeric: true },
  { key: "total", label: "Total", width: "13%", numeric: true },
];

function WorkEntriesTypeTable({ entries, type, title }: { entries: WorkEntryRow[]; type: WorkEntryType; title: string }) {
  const rows = entries.filter((entry) => entry.entry_type === type);
  const total = rows.reduce((sum, entry) => sum + Number(entry.total_amount), 0);

  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.emptyMessage}>Nenhum item registrado.</Text>
      ) : (
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            {WORK_ENTRY_COLUMNS.map((column) => (
              <Text
                key={column.key}
                style={[styles.th, { width: column.width }, column.numeric ? styles.right : {}]}
              >
                {column.label}
              </Text>
            ))}
          </View>

          {rows.map((entry) => (
            <View key={entry.id} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, { width: "12%" }]}>{formatDate(entry.entry_date)}</Text>
              <Text style={[styles.td, { width: "28%" }]}>{entry.description}</Text>
              <Text style={[styles.td, { width: "20%" }]}>{entry.supplier_name ?? "—"}</Text>
              <Text style={[styles.td, styles.right, { width: "14%" }]}>
                {formatDecimal(entry.quantity)} {WORK_ENTRY_UNIT_LABELS[entry.unit]}
              </Text>
              <Text style={[styles.td, styles.right, { width: "13%" }]}>
                {formatCurrency(entry.unit_price)}
              </Text>
              <Text style={[styles.td, styles.right, styles.bold, { width: "13%" }]}>
                {formatCurrency(entry.total_amount)}
              </Text>
            </View>
          ))}

          <View style={styles.tableFooter}>
            <Text style={[styles.td, styles.bold, { width: "60%" }]}>Total</Text>
            <Text style={[styles.td, { width: "14%" }]} />
            <Text style={[styles.td, styles.right, styles.bold, { width: "13%" }]} />
            <Text style={[styles.td, styles.right, styles.bold, { width: "13%" }]}>
              {formatCurrency(total)}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

export interface WorkReportPhoto {
  url: string;
  category: WorkAttachmentCategory;
  description: string | null;
}

export interface WorkReportDocument {
  fileName: string;
  category: WorkAttachmentCategory;
  createdAt: string;
}

export interface WorkReportData {
  branding: ReportBranding;
  work: WorkRow;
  totals: WorkTotals;
  entries: WorkEntryRow[];
  photos: WorkReportPhoto[];
  documents: WorkReportDocument[];
}

const WORK_PHOTO_GROUPS: { category: WorkAttachmentCategory; label: string }[] = [
  { category: "foto_antes", label: "Antes" },
  { category: "foto_durante", label: "Durante" },
  { category: "foto_depois", label: "Depois" },
];

function WorkPhotosSection({ photos }: { photos: WorkReportPhoto[] }) {
  if (photos.length === 0) {
    return <Text style={styles.emptyMessage}>Nenhuma foto registrada.</Text>;
  }

  return (
    <>
      {WORK_PHOTO_GROUPS.map((group) => {
        const groupPhotos = photos.filter((photo) => photo.category === group.category);
        if (groupPhotos.length === 0) return null;

        return (
          <View key={group.category} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={[styles.td, styles.bold, { marginBottom: 4 }]}>{group.label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {groupPhotos.map((photo) => (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image
                  key={photo.url}
                  src={photo.url}
                  style={{ width: 110, height: 90, objectFit: "cover", borderRadius: 4 }}
                />
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

function WorkDocumentsSection({ documents }: { documents: WorkReportDocument[] }) {
  if (documents.length === 0) {
    return <Text style={styles.emptyMessage}>Nenhum documento anexado.</Text>;
  }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.th, { width: "50%" }]}>Nome do arquivo</Text>
        <Text style={[styles.th, { width: "30%" }]}>Categoria</Text>
        <Text style={[styles.th, { width: "20%" }]}>Enviado em</Text>
      </View>
      {documents.map((document) => (
        <View key={document.fileName + document.createdAt} style={styles.tableRow} wrap={false}>
          <Text style={[styles.td, { width: "50%" }]}>{document.fileName}</Text>
          <Text style={[styles.td, { width: "30%" }]}>
            {WORK_ATTACHMENT_CATEGORY_LABELS[document.category]}
          </Text>
          <Text style={[styles.td, { width: "20%" }]}>{formatDate(document.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

function WorkReport({ data }: { data: WorkReportData }) {
  const { branding, work, totals } = data;

  return (
    <Document title={`Relatório da obra ${work.code}`}>
      <Page size="A4" style={styles.page}>
        <Header branding={branding} title={work.title} subtitle={`${work.code} · ${work.property_label}`} />

        <Text style={styles.sectionTitle}>Identificação</Text>
        <Text style={styles.filterLine}>Endereço: {work.address}</Text>
        <Text style={styles.filterLine}>Proprietário: {work.owner_label}</Text>
        <Text style={styles.filterLine}>Responsável interno: {work.responsible_name}</Text>
        <Text style={styles.filterLine}>Categoria: {WORK_CATEGORY_LABELS[work.category]}</Text>
        <Text style={styles.filterLine}>Prioridade: {WORK_PRIORITY_LABELS[work.priority]}</Text>
        <Text style={styles.filterLine}>Status: {WORK_STATUS_LABELS[work.status]}</Text>
        <Text style={styles.filterLine}>
          Início: {work.started_at ? formatDate(work.started_at) : "—"} · Previsão:{" "}
          {work.expected_at ? formatDate(work.expected_at) : "—"} · Conclusão:{" "}
          {work.completed_at ? formatDate(work.completed_at) : "—"}
        </Text>

        <Text style={styles.sectionTitle}>Descrição</Text>
        <Text style={styles.td}>{work.description}</Text>

        <WorkEntriesTypeTable entries={data.entries} type="servico" title="Serviços" />
        <WorkEntriesTypeTable entries={data.entries} type="material" title="Materiais" />
        <WorkEntriesTypeTable entries={data.entries} type="outro_custo" title="Outros custos" />

        <Text style={styles.sectionTitle}>Resumo financeiro</Text>
        <View style={styles.cardsRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Materiais</Text>
            <Text style={styles.cardValue}>{formatCurrency(totals.materialsTotal)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Serviços</Text>
            <Text style={styles.cardValue}>{formatCurrency(totals.servicesTotal)}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Outros custos</Text>
            <Text style={styles.cardValue}>{formatCurrency(totals.otherTotal)}</Text>
          </View>
          <View style={[styles.card, { borderColor: branding.accentColor }]}>
            <Text style={styles.cardLabel}>Total geral</Text>
            <Text style={[styles.cardValue, { color: branding.accentColor }]}>
              {formatCurrency(totals.grandTotal)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Fotos</Text>
        <WorkPhotosSection photos={data.photos} />

        <Text style={styles.sectionTitle}>Documentos</Text>
        <WorkDocumentsSection documents={data.documents} />

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

export interface WorksListReportRow {
  code: string;
  title: string;
  propertyLabel: string;
  status: WorkRow["status"];
  startedAt: string | null;
  totalAmount: number;
}

export interface WorksListReportData {
  branding: ReportBranding;
  periodLabel: string;
  filters: string[];
  rows: WorksListReportRow[];
}

function WorksListReport({ data }: { data: WorksListReportData }) {
  const { branding, rows } = data;
  const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);

  return (
    <Document title="Relatório geral de obras">
      <Page size="A4" style={styles.page} orientation="landscape">
        <Header branding={branding} title="Relatório de obras" subtitle={data.periodLabel} />

        <Text style={styles.sectionTitle}>Filtros aplicados</Text>
        {data.filters.map((filter) => (
          <Text key={filter} style={styles.filterLine}>
            • {filter}
          </Text>
        ))}

        <Text style={styles.sectionTitle}>Obras ({formatInteger(rows.length)})</Text>
        {rows.length === 0 ? (
          <Text style={styles.emptyMessage}>Nenhuma obra encontrada para os filtros selecionados.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={[styles.th, { width: "12%" }]}>Código</Text>
              <Text style={[styles.th, { width: "28%" }]}>Título</Text>
              <Text style={[styles.th, { width: "24%" }]}>Imóvel</Text>
              <Text style={[styles.th, { width: "14%" }]}>Status</Text>
              <Text style={[styles.th, { width: "10%" }]}>Início</Text>
              <Text style={[styles.th, styles.right, { width: "12%" }]}>Gasto total</Text>
            </View>

            {rows.map((row) => (
              <View key={row.code} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, { width: "12%" }]}>{row.code}</Text>
                <Text style={[styles.td, { width: "28%" }]}>{row.title}</Text>
                <Text style={[styles.td, { width: "24%" }]}>{row.propertyLabel}</Text>
                <Text style={[styles.td, { width: "14%" }]}>{WORK_STATUS_LABELS[row.status]}</Text>
                <Text style={[styles.td, { width: "10%" }]}>
                  {row.startedAt ? formatDate(row.startedAt) : "—"}
                </Text>
                <Text style={[styles.td, styles.right, styles.bold, { width: "12%" }]}>
                  {formatCurrency(row.totalAmount)}
                </Text>
              </View>
            ))}

            <View style={styles.tableFooter}>
              <Text style={[styles.td, styles.bold, { width: "88%" }]}>Total geral</Text>
              <Text style={[styles.td, styles.right, styles.bold, { width: "12%" }]}>
                {formatCurrency(grandTotal)}
              </Text>
            </View>
          </View>
        )}

        <Footer branding={branding} />
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------------------
// Renderização
// -----------------------------------------------------------------------------

export async function renderWorkReport(data: WorkReportData): Promise<Buffer> {
  return renderToBuffer(<WorkReport data={data} />);
}

export async function renderWorksListReport(data: WorksListReportData): Promise<Buffer> {
  return renderToBuffer(<WorksListReport data={data} />);
}

export async function renderMonthlyReport(data: MonthlyReportData): Promise<Buffer> {
  return renderToBuffer(<MonthlyReport data={data} />);
}

export async function renderAnnualReport(data: AnnualReportData): Promise<Buffer> {
  return renderToBuffer(<AnnualReport data={data} />);
}

export async function renderBrokerReport(data: BrokerReportData): Promise<Buffer> {
  return renderToBuffer(<BrokerReport data={data} />);
}

export async function renderFilteredReport(data: FilteredReportData): Promise<Buffer> {
  return renderToBuffer(<FilteredReport data={data} />);
}
