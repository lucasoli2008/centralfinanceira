import "server-only";

import * as React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCurrency, formatPercent } from "@/lib/formatting/number";
import { formatDate, formatDateTime, monthName, monthShortName } from "@/lib/formatting/date";
import { FIN_ENTRY_STATUS_LABELS } from "@/lib/formatting/labels";
import type { DreStatement } from "@/lib/finance/dre";
import type { FinCategoryTotalRow, FinEntryDetailRow, FinSummaryRow, FinYearCardRow } from "@/types/database";
import type { MonthRecurringItem } from "@/server/queries/finance-month";
import type { ReportBranding } from "./pdf";

/**
 * Relatórios do Controle Financeiro (mês e ano) com identidade visual.
 * Todos os números chegam prontos das consultas das telas.
 */

const INK = "#1c1917";
const MUTED = "#57534e";
const SUBTLE = "#8a8580";
const LINE = "#e7e5e4";
const SOFT = "#fafaf9";
const IN = "#2563eb";
const OUT = "#a8a29e";
const POSITIVE = "#15803d";
const NEGATIVE = "#b91c1c";

const s = StyleSheet.create({
  page: { paddingTop: 0, paddingBottom: 46, paddingHorizontal: 0, fontSize: 8.5, color: INK, fontFamily: "Helvetica" },
  band: { paddingHorizontal: 32, paddingTop: 26, paddingBottom: 22, color: "#ffffff" },
  bandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  bandOrg: { fontSize: 10, fontFamily: "Helvetica-Bold", opacity: 0.95 },
  bandKicker: { fontSize: 8, opacity: 0.85, marginTop: 2 },
  bandTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 14 },
  bandSubtitle: { fontSize: 9.5, opacity: 0.9, marginTop: 3 },
  logo: { width: 34, height: 34, objectFit: "contain", borderRadius: 4, backgroundColor: "#ffffff", padding: 3 },
  body: { paddingHorizontal: 32, paddingTop: 18 },
  cards: { flexDirection: "row", gap: 8, marginBottom: 14 },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 9, backgroundColor: "#ffffff" },
  cardLabel: { fontSize: 7, color: MUTED, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  cardHint: { fontSize: 6.8, color: SUBTLE, marginTop: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  note: { fontSize: 7.5, color: MUTED, marginBottom: 6 },
  twoCols: { flexDirection: "row", gap: 14 },
  col: { flex: 1 },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  barLabel: { width: 120, fontSize: 7.8, color: INK },
  barTrack: { flex: 1, height: 7, backgroundColor: "#f1f0ef", borderRadius: 4 },
  barFill: { height: 7, borderRadius: 4 },
  barValue: { width: 70, textAlign: "right", fontSize: 7.8, fontFamily: "Helvetica-Bold" },
  table: { borderWidth: 1, borderColor: LINE, borderRadius: 6 },
  th: { flexDirection: "row", backgroundColor: SOFT, borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#f0efee" },
  zebra: { backgroundColor: "#fcfcfb" },
  thText: { fontSize: 6.8, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase" },
  right: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 5,
    fontSize: 6.5,
    color: SUBTLE,
  },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  monthCell: { width: "15.6%", borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 5 },
});

function brand(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#9f1239";
}

function Band({ branding, kicker, title, subtitle }: { branding: ReportBranding; kicker: string; title: string; subtitle: string }) {
  return (
    <View style={[s.band, { backgroundColor: brand(branding.accentColor) }]}>
      <View style={s.bandRow}>
        <View>
          <Text style={s.bandOrg}>{branding.organizationName}</Text>
          <Text style={s.bandKicker}>{kicker}</Text>
        </View>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        {branding.logoUrl ? <Image src={branding.logoUrl} style={s.logo} /> : null}
      </View>
      <Text style={s.bandTitle}>{title}</Text>
      <Text style={s.bandSubtitle}>{subtitle}</Text>
    </View>
  );
}

function Footer({ branding }: { branding: ReportBranding }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        Gerado em {formatDateTime(new Date())} por {branding.generatedBy} · {branding.footer ?? "Relatório gerencial — não substitui a contabilidade oficial."}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Card({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, color ? { color } : {}]}>{value}</Text>
      {hint ? <Text style={s.cardHint}>{hint}</Text> : null}
    </View>
  );
}

function Bars({ rows, color, empty }: { rows: { label: string; value: number }[]; color: string; empty: string }) {
  if (rows.length === 0) return <Text style={s.note}>{empty}</Text>;
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <View>
      {rows.map((row) => (
        <View key={row.label} style={s.barRow} wrap={false}>
          <Text style={s.barLabel}>{row.label}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${max > 0 ? Math.max(3, (row.value / max) * 100) : 0}%`, backgroundColor: color }]} />
          </View>
          <Text style={s.barValue}>{formatCurrency(row.value)}</Text>
        </View>
      ))}
    </View>
  );
}

function categoryBars(rows: FinCategoryTotalRow[]) {
  return rows
    .filter((row) => row.total !== 0)
    .map((row) => ({ label: row.category_name, value: Math.abs(row.total) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

function DreSummary({ dre }: { dre: DreStatement }) {
  return (
    <View style={s.table}>
      {dre.rows.map((row, index) => {
        const isSubtotal = row.type === "subtotal";
        const label = row.type === "section" ? row.section.label : row.subtotal.label;
        const value = row.type === "section" ? row.section.total : row.subtotal.total;
        if (row.type === "section" && row.section.groups.length === 0 && !["gross_revenue", "operating_expenses"].includes(row.section.key)) {
          return null;
        }
        return (
          <View
            key={label}
            style={[s.tr, index % 2 ? s.zebra : {}, isSubtotal ? { borderTopWidth: 1, borderTopColor: "#d6d3d1", backgroundColor: SOFT } : {}]}
            wrap={false}
          >
            <Text style={[{ flex: 1 }, isSubtotal ? s.bold : {}]}>{label}</Text>
            <Text style={[s.right, { width: 90 }, isSubtotal ? s.bold : {}, value < 0 ? { color: MUTED } : {}]}>
              {value === 0 ? "—" : formatCurrency(value)}
            </Text>
          </View>
        );
      })}
      <View style={s.tr}>
        <Text style={[{ flex: 1 }, s.muted]}>Margem líquida</Text>
        <Text style={[s.right, { width: 90 }, s.muted]}>{dre.netMargin.total === null ? "—" : formatPercent(dre.netMargin.total)}</Text>
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Relatório do mês
// -----------------------------------------------------------------------------
export interface MonthReportData {
  branding: ReportBranding;
  year: number;
  month: number;
  cash: FinSummaryRow;
  competence: FinSummaryRow;
  dre: DreStatement;
  expensesByCategory: FinCategoryTotalRow[];
  incomeByCategory: FinCategoryTotalRow[];
  bills: MonthRecurringItem[];
  entries: FinEntryDetailRow[];
  closed: boolean;
}

export async function renderMonthReport(data: MonthReportData): Promise<Buffer> {
  const label = `${monthName(data.month)} de ${data.year}`;
  const result = data.competence.net_result;
  return renderToBuffer(
    <Document title={`Relatório financeiro — ${label}`} author={data.branding.organizationName}>
      <Page size="A4" style={s.page}>
        <Band
          branding={data.branding}
          kicker="Controle Financeiro · relatório do mês"
          title={label.charAt(0).toUpperCase() + label.slice(1)}
          subtitle={data.closed ? "Mês fechado — números conferidos e travados." : "Mês em aberto — os números ainda podem mudar."}
        />
        <View style={s.body}>
          <View style={s.cards}>
            <Card label="Entrou no caixa" value={formatCurrency(data.cash.cash_in)} color={IN} />
            <Card label="Saiu do caixa" value={formatCurrency(data.cash.cash_out)} />
            <Card label="Resultado do mês" value={formatCurrency(result)} color={result < 0 ? NEGATIVE : POSITIVE} hint="Receitas − despesas da imobiliária" />
            <Card label="Saldo no fim do mês" value={formatCurrency(data.cash.cash_balance)} hint={`Da imobiliária: ${formatCurrency(data.cash.own_available)}`} />
          </View>

          <View style={s.twoCols}>
            <View style={s.col}>
              <Text style={s.h2}>Para onde foi o dinheiro</Text>
              <Bars rows={categoryBars(data.expensesByCategory)} color={OUT} empty="Nenhuma despesa no mês." />
            </View>
            <View style={s.col}>
              <Text style={s.h2}>De onde veio</Text>
              <Bars rows={categoryBars(data.incomeByCategory)} color={IN} empty="Nenhuma receita no mês." />
            </View>
          </View>

          <Text style={s.h2}>Resultado (DRE do mês)</Text>
          <DreSummary dre={data.dre} />

          {data.bills.length ? (
            <>
              <Text style={s.h2}>Contas fixas do mês</Text>
              <View style={s.table}>
                <View style={s.th}>
                  <Text style={[s.thText, { flex: 1 }]}>Conta</Text>
                  <Text style={[s.thText, { width: 70 }]}>Vencimento</Text>
                  <Text style={[s.thText, { width: 70 }]}>Situação</Text>
                  <Text style={[s.thText, s.right, { width: 80 }]}>Valor</Text>
                </View>
                {data.bills.map((bill, index) => (
                  <View key={bill.entry_id} style={[s.tr, index % 2 ? s.zebra : {}]} wrap={false}>
                    <Text style={{ flex: 1 }}>
                      {bill.description}
                      {bill.value_mode === "variable" ? " (valor variável)" : ""}
                    </Text>
                    <Text style={{ width: 70 }}>{formatDate(bill.due_date)}</Text>
                    <Text style={[{ width: 70 }, bill.status === "settled" ? { color: POSITIVE } : { color: MUTED }]}>
                      {bill.status === "settled" ? "Pago" : "Em aberto"}
                    </Text>
                    <Text style={[s.right, { width: 80 }, s.bold]}>{formatCurrency(bill.amount)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {data.competence.third_party_obligations > 0 ? (
            <Text style={[s.note, { marginTop: 10 }]}>
              Do saldo em contas, {formatCurrency(data.competence.third_party_obligations)} pertencem a proprietários e corretores (repasses
              pendentes) e não são dinheiro da imobiliária.
            </Text>
          ) : null}
        </View>
        <Footer branding={data.branding} />
      </Page>

      <Page size="A4" style={[s.page, { paddingTop: 30 }]}>
        <View style={s.body}>
          <Text style={[s.h2, { marginTop: 0 }]}>Todos os lançamentos do mês</Text>
          <Text style={s.note}>Ordenados por data de vencimento. Entradas em azul, saídas em preto.</Text>
          <View style={s.table}>
            <View style={s.th} fixed>
              <Text style={[s.thText, { width: 52 }]}>Data</Text>
              <Text style={[s.thText, { flex: 1 }]}>Descrição</Text>
              <Text style={[s.thText, { width: 110 }]}>Categoria</Text>
              <Text style={[s.thText, { width: 58 }]}>Situação</Text>
              <Text style={[s.thText, s.right, { width: 72 }]}>Valor</Text>
            </View>
            {data.entries.length === 0 ? (
              <View style={s.tr}>
                <Text style={s.muted}>Nenhum lançamento neste mês.</Text>
              </View>
            ) : null}
            {data.entries.map((entry, index) => (
              <View key={entry.id} style={[s.tr, index % 2 ? s.zebra : {}]} wrap={false}>
                <Text style={{ width: 52 }}>{formatDate(entry.reference_date)}</Text>
                <Text style={{ flex: 1 }}>
                  {entry.description}
                  {entry.counterparty_name ? ` · ${entry.counterparty_name}` : ""}
                </Text>
                <Text style={[{ width: 110 }, s.muted]}>{entry.category_name ?? "—"}</Text>
                <Text style={[{ width: 58 }, s.muted]}>{FIN_ENTRY_STATUS_LABELS[entry.status]}</Text>
                <Text style={[s.right, { width: 72 }, s.bold, entry.kind === "income" ? { color: IN } : {}]}>
                  {entry.kind === "expense" ? "−" : ""}
                  {formatCurrency(entry.amount)}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <Footer branding={data.branding} />
      </Page>
    </Document>,
  );
}

// -----------------------------------------------------------------------------
// Relatório do ano
// -----------------------------------------------------------------------------
export interface YearReportData {
  branding: ReportBranding;
  year: number;
  cards: FinYearCardRow[];
  dre: DreStatement;
  expensesByCategory: FinCategoryTotalRow[];
}

export async function renderYearReport(data: YearReportData): Promise<Buffer> {
  const totals = data.cards.reduce(
    (acc, card) => ({ in: acc.in + card.cash_in, out: acc.out + card.cash_out, result: acc.result + card.result }),
    { in: 0, out: 0, result: 0 },
  );
  const best = [...data.cards].sort((a, b) => b.result - a.result)[0];
  const worst = [...data.cards].sort((a, b) => a.result - b.result)[0];
  const max = Math.max(...data.cards.map((card) => Math.max(card.cash_in, card.cash_out)), 0);

  return renderToBuffer(
    <Document title={`Relatório financeiro ${data.year}`} author={data.branding.organizationName}>
      <Page size="A4" style={s.page}>
        <Band branding={data.branding} kicker="Controle Financeiro · relatório anual" title={`Ano de ${data.year}`} subtitle="Os 12 meses lado a lado." />
        <View style={s.body}>
          <View style={s.cards}>
            <Card label="Entrou no ano" value={formatCurrency(totals.in)} color={IN} />
            <Card label="Saiu no ano" value={formatCurrency(totals.out)} />
            <Card label="Resultado do ano" value={formatCurrency(totals.result)} color={totals.result < 0 ? NEGATIVE : POSITIVE} />
            <Card
              label="Melhor mês"
              value={best && best.result !== 0 ? monthName(best.month) : "—"}
              hint={best && best.result !== 0 ? formatCurrency(best.result) : undefined}
            />
          </View>

          <Text style={s.h2}>Mês a mês</Text>
          <View style={s.monthGrid}>
            {data.cards.map((card) => (
              <View key={card.month} style={s.monthCell} wrap={false}>
                <Text style={[s.bold, { fontSize: 8.5 }]}>{monthShortName(card.month)}</Text>
                <Text style={[{ fontSize: 9.5, marginTop: 3 }, s.bold, { color: card.result < 0 ? NEGATIVE : card.result > 0 ? POSITIVE : SUBTLE }]}>
                  {card.result === 0 ? "—" : formatCurrency(card.result)}
                </Text>
                <View style={{ marginTop: 4, height: 4, backgroundColor: "#f1f0ef", borderRadius: 2 }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: IN, width: `${max > 0 ? (card.cash_in / max) * 100 : 0}%` }} />
                </View>
                <View style={{ marginTop: 2, height: 4, backgroundColor: "#f1f0ef", borderRadius: 2 }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: OUT, width: `${max > 0 ? (card.cash_out / max) * 100 : 0}%` }} />
                </View>
                {card.is_closed ? <Text style={{ fontSize: 6, color: POSITIVE, marginTop: 3 }}>FECHADO</Text> : null}
              </View>
            ))}
          </View>
          <Text style={[s.note, { marginTop: 4 }]}>Barra azul: entradas no caixa. Barra cinza: saídas.</Text>

          <View style={s.table}>
            <View style={s.th}>
              <Text style={[s.thText, { flex: 1 }]}>Mês</Text>
              <Text style={[s.thText, s.right, { width: 80 }]}>Entrou</Text>
              <Text style={[s.thText, s.right, { width: 80 }]}>Saiu</Text>
              <Text style={[s.thText, s.right, { width: 80 }]}>Resultado</Text>
              <Text style={[s.thText, s.right, { width: 80 }]}>Saldo final</Text>
            </View>
            {data.cards.map((card, index) => (
              <View key={card.month} style={[s.tr, index % 2 ? s.zebra : {}]} wrap={false}>
                <Text style={{ flex: 1 }}>{monthName(card.month)}</Text>
                <Text style={[s.right, { width: 80 }]}>{formatCurrency(card.cash_in)}</Text>
                <Text style={[s.right, { width: 80 }]}>{formatCurrency(card.cash_out)}</Text>
                <Text style={[s.right, { width: 80 }, s.bold, { color: card.result < 0 ? NEGATIVE : INK }]}>{formatCurrency(card.result)}</Text>
                <Text style={[s.right, { width: 80 }, s.muted]}>{formatCurrency(card.closing_balance)}</Text>
              </View>
            ))}
          </View>
          {worst && worst.result < 0 ? (
            <Text style={[s.note, { marginTop: 6 }]}>
              Mês mais fraco: {monthName(worst.month)} ({formatCurrency(worst.result)}).
            </Text>
          ) : null}
        </View>
        <Footer branding={data.branding} />
      </Page>
      <Page size="A4" style={[s.page, { paddingTop: 30 }]}>
        <View style={s.body}>
          <Text style={[s.h2, { marginTop: 0 }]}>Resultado do ano (DRE)</Text>
          <DreSummary dre={data.dre} />
          <Text style={s.h2}>Maiores despesas do ano</Text>
          <Bars rows={categoryBars(data.expensesByCategory)} color={OUT} empty="Nenhuma despesa no ano." />
        </View>
        <Footer branding={data.branding} />
      </Page>
    </Document>,
  );
}
