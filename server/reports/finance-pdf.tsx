import "server-only";

import * as React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDateTime, monthShortName } from "@/lib/formatting/date";
import type { DreSection, DreStatement, DreValues } from "@/lib/finance/dre";
import type { FinAccountBalanceRow, FinCloseCheckRow, FinSummaryRow } from "@/types/database";
import type { ReportBranding } from "./pdf";

/**
 * PDFs do Controle Financeiro. Recebem os mesmos objetos das telas (getDre,
 * getFinSummary, getCloseChecklist) — nada é recalculado aqui.
 */

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 44, paddingHorizontal: 30, fontSize: 8, color: "#1c1917", fontFamily: "Helvetica" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5e4",
    paddingBottom: 8,
    marginBottom: 12,
  },
  logo: { width: 30, height: 30, objectFit: "contain", marginRight: 8 },
  organization: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  caption: { fontSize: 7, color: "#57534e", marginTop: 2 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtitle: { fontSize: 8.5, color: "#57534e", marginBottom: 10 },
  sectionTitle: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 5 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  card: { width: "24%", borderWidth: 1, borderColor: "#e7e5e4", borderRadius: 5, padding: 6 },
  cardLabel: { fontSize: 6.5, color: "#57534e", marginBottom: 2 },
  cardValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#f0efee", paddingVertical: 2.5 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#d6d3d1", paddingVertical: 3, backgroundColor: "#fafaf9" },
  sectionRow: { backgroundColor: "#fafaf9" },
  subtotalRow: { borderTopWidth: 1, borderTopColor: "#a8a29e" },
  emphasisRow: { backgroundColor: "#fdf2f2" },
  label: { flex: 1, paddingHorizontal: 4 },
  num: { width: 52, textAlign: "right", paddingHorizontal: 3 },
  total: { width: 64, textAlign: "right", paddingHorizontal: 3, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#78716c" },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e7e5e4",
    paddingTop: 5,
    fontSize: 6.5,
    color: "#8a8580",
  },
  note: { fontSize: 7, color: "#57534e", marginTop: 8 },
});

function Header({ branding }: { branding: ReportBranding }) {
  return (
    <View style={styles.headerRow} fixed>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
        <View>
          <Text style={styles.organization}>{branding.organizationName}</Text>
          <Text style={styles.caption}>{branding.header ?? "Controle Financeiro"}</Text>
        </View>
      </View>
      <View>
        <Text style={[styles.caption, { textAlign: "right" }]}>Gerado em {formatDateTime(new Date())}</Text>
        <Text style={[styles.caption, { textAlign: "right" }]}>por {branding.generatedBy}</Text>
      </View>
    </View>
  );
}

function Footer({ branding }: { branding: ReportBranding }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{branding.footer ?? "Relatório gerencial — não substitui a contabilidade oficial."}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

const money = (value: number) => (value === 0 ? "—" : formatCurrency(value));

function periodLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${monthShortName(month)}/${String(year).slice(2)}`;
}

function ValueRow({
  label,
  values,
  periods,
  indent = 0,
  rowStyle,
  bold = false,
}: {
  label: string;
  values: DreValues;
  periods: string[];
  indent?: number;
  rowStyle?: Styles[string][];
  bold?: boolean;
}) {
  return (
    <View style={[styles.row, ...(rowStyle ?? [])]} wrap={false}>
      <Text style={[styles.label, { paddingLeft: 4 + indent * 10 }, ...(bold ? [styles.bold] : indent === 2 ? [styles.muted] : [])]}>
        {label}
      </Text>
      {periods.map((period) => (
        <Text key={period} style={[styles.num, ...(bold ? [styles.bold] : [])]}>
          {money(values.byPeriod[period] ?? 0)}
        </Text>
      ))}
      <Text style={styles.total}>{money(values.total)}</Text>
    </View>
  );
}

function SectionBlock({ section, periods }: { section: DreSection; periods: string[] }) {
  return (
    <>
      <ValueRow label={section.label} values={section} periods={periods} rowStyle={[styles.sectionRow]} bold />
      {section.groups.map((group) => (
        <React.Fragment key={group.id}>
          <ValueRow label={group.name} values={group} periods={periods} indent={1} />
          {group.categories.length > 1 || group.categories[0]?.name !== group.name
            ? group.categories.map((category) => (
                <ValueRow key={category.id} label={category.name} values={category} periods={periods} indent={2} />
              ))
            : null}
        </React.Fragment>
      ))}
    </>
  );
}

function DreBlock({ dre, monthColumns }: { dre: DreStatement; monthColumns: boolean }) {
  const periods = monthColumns && dre.periods.length > 1 && dre.periods.length <= 12 ? dre.periods : [];
  return (
    <View>
      <View style={styles.headRow} fixed>
        <Text style={[styles.label, styles.bold]}>Linha</Text>
        {periods.map((period) => (
          <Text key={period} style={[styles.num, styles.bold]}>
            {periodLabel(period)}
          </Text>
        ))}
        <Text style={styles.total}>Total</Text>
      </View>
      {dre.rows.map((row) =>
        row.type === "section" ? (
          row.section.groups.length || ["gross_revenue", "operating_expenses"].includes(row.section.key) ? (
            <SectionBlock key={row.section.key} section={row.section} periods={periods} />
          ) : null
        ) : (
          <ValueRow
            key={row.subtotal.key}
            label={row.subtotal.label}
            values={row.subtotal}
            periods={periods}
            rowStyle={[styles.subtotalRow, ...(row.subtotal.emphasis ? [styles.emphasisRow] : [])]}
            bold
          />
        ),
      )}
      <View style={styles.row}>
        <Text style={[styles.label, styles.muted]}>Margem líquida</Text>
        {periods.map((period) => (
          <Text key={period} style={[styles.num, styles.muted]}>
            {dre.netMargin[period] === null || dre.netMargin[period] === undefined ? "—" : formatPercent(dre.netMargin[period] as number)}
          </Text>
        ))}
        <Text style={styles.total}>{dre.netMargin.total === null ? "—" : formatPercent(dre.netMargin.total)}</Text>
      </View>
      {dre.memo.length ? (
        <>
          <Text style={styles.sectionTitle}>Fora do resultado (memória)</Text>
          {dre.memo.map((section) => (
            <SectionBlock key={section.key} section={section} periods={periods} />
          ))}
        </>
      ) : null}
    </View>
  );
}

export interface DreReportData {
  branding: ReportBranding;
  title: string;
  subtitle: string;
  dre: DreStatement;
}

export async function renderDreReport(data: DreReportData): Promise<Buffer> {
  const landscape = data.dre.periods.length > 4;
  return renderToBuffer(
    <Document title={data.title} author={data.branding.organizationName}>
      <Page size="A4" orientation={landscape ? "landscape" : "portrait"} style={styles.page}>
        <Header branding={data.branding} />
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.subtitle}>{data.subtitle}</Text>
        <DreBlock dre={data.dre} monthColumns />
        <Text style={styles.note}>
          Valores de terceiros (aluguéis a repassar, repasses a corretores), cauções e movimentos de sócios não entram no resultado.
        </Text>
        <Footer branding={data.branding} />
      </Page>
    </Document>,
  );
}

export interface ClosingReportData {
  branding: ReportBranding;
  label: string;
  status: string;
  notes: string | null;
  summary: FinSummaryRow;
  dre: DreStatement;
  checklist: FinCloseCheckRow[];
  balances: FinAccountBalanceRow[];
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{value}</Text>
    </View>
  );
}

export async function renderClosingReport(data: ClosingReportData): Promise<Buffer> {
  const { summary } = data;
  return renderToBuffer(
    <Document title={`Fechamento ${data.label}`} author={data.branding.organizationName}>
      <Page size="A4" style={styles.page}>
        <Header branding={data.branding} />
        <Text style={styles.title}>Fechamento mensal — {data.label}</Text>
        <Text style={styles.subtitle}>{data.status}</Text>
        {data.notes ? <Text style={[styles.subtitle, { marginTop: -6 }]}>Observações: {data.notes}</Text> : null}

        <View style={styles.cards}>
          <Card label="Resultado (competência)" value={formatCurrency(summary.net_result)} />
          <Card label="Receita própria" value={formatCurrency(summary.own_revenue + summary.other_revenue)} />
          <Card label="Entradas no caixa" value={formatCurrency(summary.cash_in)} />
          <Card label="Saídas do caixa" value={formatCurrency(summary.cash_out)} />
          <Card label="Saldo em contas (fim do mês)" value={formatCurrency(summary.cash_balance)} />
          <Card label="Obrigações com terceiros" value={formatCurrency(summary.third_party_obligations)} />
          <Card label="Disponível da imobiliária" value={formatCurrency(summary.own_available)} />
          <Card label="Retiradas de sócios" value={formatCurrency(summary.partner_withdrawals)} />
        </View>

        <Text style={styles.sectionTitle}>DRE gerencial do mês</Text>
        <DreBlock dre={data.dre} monthColumns={false} />

        <Text style={styles.sectionTitle}>Saldos por conta no último dia do mês</Text>
        {data.balances.map((account) => (
          <View key={account.account_id} style={styles.row}>
            <Text style={styles.label}>{account.name}</Text>
            <Text style={styles.total}>{formatCurrency(account.balance)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Checklist</Text>
        {data.checklist.map((item) => (
          <View key={item.check_key} style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={[styles.total, { width: 110 }]}>
              {item.quantity === 0 ? "OK" : `Pendente: ${item.quantity} (${formatCurrency(item.amount)})`}
            </Text>
          </View>
        ))}
        <Footer branding={data.branding} />
      </Page>
    </Document>,
  );
}
