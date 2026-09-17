import "server-only";

import * as React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatCurrency, formatDecimal, formatInteger } from "@/lib/formatting/number";
import { formatDate, formatDateTime } from "@/lib/formatting/date";
import {
  WORK_ATTACHMENT_CATEGORY_LABELS,
  WORK_CATEGORY_LABELS,
  WORK_ENTRY_UNIT_LABELS,
  WORK_PRIORITY_LABELS,
  WORK_STATUS_LABELS,
} from "@/lib/formatting/labels";
import type {
  WorkActivityRow,
  WorkAttachmentCategory,
  WorkEntryRow,
  WorkEntryType,
  WorkRow,
  WorkStatus,
} from "@/types/database";
import type { WorkTotals } from "@/lib/works/types";
import type { ReportBranding } from "./pdf";
import type { PdfImage } from "./work-attachments";
import { ensureWorkReportFont } from "./work-fonts";

/**
 * Relatórios do módulo Obras. Separados de `pdf.tsx` porque usam identidade
 * própria (fonte Geist, faixa com a cor da marca, fotos e notas fiscais
 * embutidas) sem tocar nos relatórios financeiros.
 */

// -----------------------------------------------------------------------------
// Dados
// -----------------------------------------------------------------------------

export interface WorkReportPhoto {
  id: string;
  category: WorkAttachmentCategory;
  caption: string | null;
  image: PdfImage;
}

export interface WorkReportInvoiceEntry {
  description: string;
  totalAmount: number;
  isPaid: boolean;
  paidAt: string | null;
}

export interface WorkReportInvoice {
  id: string;
  fileName: string;
  category: WorkAttachmentCategory;
  createdAt: string;
  description: string | null;
  /** Presente quando o anexo é imagem (embutida na seção de notas). */
  image: PdfImage | null;
  /** Presente quando o anexo é PDF e foi colado ao final do relatório. */
  appendixNumber: number | null;
  /** PDF que não coube no limite de páginas do apêndice. */
  skipped: boolean;
  entry: WorkReportInvoiceEntry | null;
}

export interface WorkReportData {
  branding: ReportBranding;
  work: WorkRow;
  totals: WorkTotals;
  entries: WorkEntryRow[];
  photos: WorkReportPhoto[];
  invoices: WorkReportInvoice[];
  activities: WorkActivityRow[];
}

export interface WorksListReportRow {
  code: string;
  title: string;
  propertyLabel: string;
  status: WorkStatus;
  startedAt: string | null;
  totalAmount: number;
  paidAmount: number;
}

export interface WorksListReportData {
  branding: ReportBranding;
  periodLabel: string;
  filters: string[];
  rows: WorksListReportRow[];
}

// -----------------------------------------------------------------------------
// Tema
// -----------------------------------------------------------------------------

const INK = "#1c1917";
const MUTED = "#57534e";
const SUBTLE = "#8a8580";
const BORDER = "#e7e5e4";
const SOFT = "#fafaf9";
const POSITIVE = "#15803d";
const POSITIVE_SOFT = "#ecfdf3";
const WARNING = "#b45309";
const WARNING_SOFT = "#fff7ed";
const DANGER = "#b91c1c";

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mistura a cor da marca com branco (0 = cor pura, 1 = branco). */
function tint(hex: string, amount: number): string {
  const rgb = hexToRgb(hex) ?? [15, 81, 50];
  const mix = rgb.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mix.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const STATUS_COLORS: Record<WorkStatus, { fg: string; bg: string }> = {
  planejada: { fg: MUTED, bg: "#f5f5f4" },
  em_andamento: { fg: "#1d4ed8", bg: "#eff6ff" },
  pausada: { fg: WARNING, bg: WARNING_SOFT },
  aguardando_material: { fg: WARNING, bg: WARNING_SOFT },
  aguardando_prestador: { fg: WARNING, bg: WARNING_SOFT },
  concluida: { fg: POSITIVE, bg: POSITIVE_SOFT },
  cancelada: { fg: DANGER, bg: "#fef2f2" },
};

function buildStyles(font: string) {
  return StyleSheet.create({
    page: {
      paddingTop: 30,
      paddingBottom: 46,
      paddingHorizontal: 34,
      fontSize: 9,
      color: INK,
      fontFamily: font,
    },
    topbar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    topbarText: { fontSize: 7, color: SUBTLE, letterSpacing: 0.6, textTransform: "uppercase" },
    hero: { borderRadius: 10, padding: 18, marginBottom: 14 },
    heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    heroEyebrow: { fontSize: 7.5, color: "#ffffff", opacity: 0.85, letterSpacing: 1, textTransform: "uppercase" },
    heroTitle: { fontSize: 19, color: "#ffffff", fontWeight: 700, marginTop: 4, lineHeight: 1.15 },
    heroSubtitle: { fontSize: 9, color: "#ffffff", opacity: 0.9, marginTop: 4 },
    heroLogoBox: {
      backgroundColor: "#ffffff",
      borderRadius: 8,
      padding: 6,
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    heroLogo: { width: 32, height: 32, objectFit: "contain" },
    heroMeta: { flexDirection: "row", gap: 18, marginTop: 14 },
    heroMetaLabel: { fontSize: 6.5, color: "#ffffff", opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.8 },
    heroMetaValue: { fontSize: 8.5, color: "#ffffff", fontWeight: 500, marginTop: 2 },
    pill: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 2.5,
      fontSize: 6.5,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    kpiRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    kpi: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 9 },
    kpiLabel: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
    kpiValue: { fontSize: 12.5, fontWeight: 600, marginTop: 4 },
    kpiHint: { fontSize: 6.5, color: SUBTLE, marginTop: 2 },
    progressTrack: { height: 4, backgroundColor: "#f0efee", borderRadius: 2, marginTop: 6 },
    progressFill: { height: 4, borderRadius: 2 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 16,
      marginBottom: 7,
    },
    sectionIndex: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    sectionIndexText: { fontSize: 7, color: "#ffffff", fontWeight: 700 },
    sectionTitle: { fontSize: 10.5, fontWeight: 600 },
    sectionCount: { fontSize: 7.5, color: SUBTLE },
    sectionRule: { flex: 1, height: 0.5, backgroundColor: BORDER, marginLeft: 4 },
    factsGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 7 },
    fact: { width: "25%", paddingRight: 8 },
    factWide: { width: "50%", paddingRight: 8 },
    factLabel: { fontSize: 6.5, color: SUBTLE, textTransform: "uppercase", letterSpacing: 0.6 },
    factValue: { fontSize: 8.5, marginTop: 1.5 },
    paragraphBox: {
      backgroundColor: SOFT,
      borderRadius: 8,
      padding: 10,
      fontSize: 8.5,
      lineHeight: 1.45,
      color: INK,
    },
    table: { borderWidth: 1, borderColor: BORDER, borderRadius: 6, overflow: "hidden" },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: SOFT,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
      paddingVertical: 5,
      paddingHorizontal: 7,
    },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 0.5,
      borderBottomColor: "#f0efee",
      paddingVertical: 4.5,
      paddingHorizontal: 7,
    },
    tableRowAlt: { backgroundColor: "#fcfcfb" },
    tableFooter: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: SOFT,
      borderTopWidth: 1,
      borderTopColor: "#d6d3d1",
      paddingVertical: 5,
      paddingHorizontal: 7,
    },
    th: { fontSize: 6.5, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 },
    td: { fontSize: 8 },
    tdMuted: { fontSize: 7, color: SUBTLE },
    right: { textAlign: "right" },
    semibold: { fontWeight: 600 },
    empty: { fontSize: 8.5, color: SUBTLE, paddingVertical: 10, textAlign: "center" },
    photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    photoCell: { width: "31.8%" },
    photo: { width: "100%", height: 118, objectFit: "cover", borderRadius: 6, backgroundColor: SOFT },
    photoCaption: { fontSize: 7, color: MUTED, marginTop: 3 },
    invoiceCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 8, marginBottom: 10, overflow: "hidden" },
    invoiceHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: SOFT,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
    },
    invoiceMeta: { paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", gap: 14, flexWrap: "wrap" },
    invoiceImage: { width: "100%", maxHeight: 400, objectFit: "contain", backgroundColor: "#f5f5f4" },
    invoicePdfBox: {
      margin: 9,
      marginTop: 0,
      borderRadius: 6,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: "#d6d3d1",
      padding: 10,
      fontSize: 8,
      color: MUTED,
    },
    activityRow: { flexDirection: "row", gap: 8, paddingVertical: 3.5, borderBottomWidth: 0.5, borderBottomColor: "#f0efee" },
    activityDate: { width: 88, fontSize: 7, color: SUBTLE },
    activityText: { flex: 1, fontSize: 8 },
    footer: {
      position: "absolute",
      bottom: 20,
      left: 34,
      right: 34,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.5,
      borderTopColor: BORDER,
      paddingTop: 6,
      fontSize: 6.5,
      color: SUBTLE,
    },
  });
}

type Styles = ReturnType<typeof buildStyles>;

// -----------------------------------------------------------------------------
// Blocos
// -----------------------------------------------------------------------------

function StatusPill({ status, s }: { status: WorkStatus; s: Styles }) {
  const colors = STATUS_COLORS[status];
  return (
    <Text style={[s.pill, { color: colors.fg, backgroundColor: colors.bg }]}>{WORK_STATUS_LABELS[status]}</Text>
  );
}

function PaidPill({ paid, s }: { paid: boolean; s: Styles }) {
  return (
    <Text
      style={[
        s.pill,
        paid ? { color: POSITIVE, backgroundColor: POSITIVE_SOFT } : { color: WARNING, backgroundColor: WARNING_SOFT },
        { fontSize: 6, paddingHorizontal: 5, paddingVertical: 1.5 },
      ]}
    >
      {paid ? "Pago" : "A pagar"}
    </Text>
  );
}

function TopBar({ branding, right, s }: { branding: ReportBranding; right: string; s: Styles }) {
  return (
    <View style={s.topbar} fixed>
      <Text style={s.topbarText}>{branding.organizationName}</Text>
      <Text style={s.topbarText}>{right}</Text>
    </View>
  );
}

function ReportFooter({ branding, left, s }: { branding: ReportBranding; left: string; s: Styles }) {
  return (
    <View style={s.footer} fixed>
      <Text>{branding.footer ?? `${branding.organizationName} · Documento confidencial`}</Text>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

function SectionHeader({
  index,
  title,
  count,
  accent,
  s,
  breakBefore = false,
}: {
  index: string;
  title: string;
  count?: string;
  accent: string;
  s: Styles;
  breakBefore?: boolean;
}) {
  return (
    <View style={s.sectionHeader} break={breakBefore} minPresenceAhead={80}>
      <View style={[s.sectionIndex, { backgroundColor: accent }]}>
        <Text style={s.sectionIndexText}>{index}</Text>
      </View>
      <Text style={s.sectionTitle}>{title}</Text>
      {count ? <Text style={s.sectionCount}>{count}</Text> : null}
      <View style={s.sectionRule} />
    </View>
  );
}

function Kpi({
  label,
  value,
  hint,
  color,
  s,
  accentBorder,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  s: Styles;
  accentBorder?: string;
}) {
  return (
    <View style={[s.kpi, accentBorder ? { borderColor: accentBorder, borderLeftWidth: 3 } : {}]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, color ? { color } : {}]}>{value}</Text>
      {hint ? <Text style={s.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

const ENTRY_COLUMNS: { key: string; label: string; width: string; right?: boolean; padLeft?: boolean }[] = [
  { key: "date", label: "Data", width: "10%" },
  { key: "description", label: "Descrição", width: "31%" },
  { key: "supplier", label: "Fornecedor", width: "17%" },
  { key: "quantity", label: "Qtd.", width: "11%", right: true },
  { key: "unit", label: "Unitário", width: "11%", right: true },
  { key: "paid", label: "Pago", width: "9%", padLeft: true },
  { key: "total", label: "Total", width: "11%", right: true },
];

function EntriesTable({
  entries,
  type,
  index,
  title,
  accent,
  s,
}: {
  entries: WorkEntryRow[];
  type: WorkEntryType;
  index: string;
  title: string;
  accent: string;
  s: Styles;
}) {
  const rows = entries.filter((entry) => entry.entry_type === type);
  const subtotal = rows.reduce((sum, entry) => sum + Number(entry.total_amount), 0);
  const paid = rows.filter((entry) => entry.is_paid).reduce((sum, entry) => sum + Number(entry.total_amount), 0);

  return (
    <>
      <SectionHeader
        index={index}
        title={title}
        count={`${rows.length} ${rows.length === 1 ? "item" : "itens"}`}
        accent={accent}
        s={s}
      />
      {rows.length === 0 ? (
        <Text style={s.empty}>Nenhum item registrado.</Text>
      ) : (
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            {ENTRY_COLUMNS.map((column) => (
              <Text
                key={column.key}
                style={[s.th, { width: column.width }, column.right ? s.right : {}, column.padLeft ? { paddingLeft: 6 } : {}]}
              >
                {column.label}
              </Text>
            ))}
          </View>

          {rows.map((entry, rowIndex) => (
            <View key={entry.id} style={[s.tableRow, rowIndex % 2 === 1 ? s.tableRowAlt : {}]} wrap={false}>
              <Text style={[s.td, { width: "10%" }]}>{formatDate(entry.entry_date)}</Text>
              <View style={{ width: "31%", paddingRight: 6 }}>
                <Text style={s.td}>{entry.description}</Text>
                {entry.category ? <Text style={s.tdMuted}>{entry.category}</Text> : null}
              </View>
              <Text style={[s.td, { width: "17%", paddingRight: 6 }]}>{entry.supplier_name ?? "—"}</Text>
              <Text style={[s.td, s.right, { width: "11%" }]}>
                {formatDecimal(entry.quantity)} {WORK_ENTRY_UNIT_LABELS[entry.unit]}
              </Text>
              <Text style={[s.td, s.right, { width: "11%" }]}>{formatCurrency(entry.unit_price)}</Text>
              <View style={{ width: "9%", paddingLeft: 6 }}>
                <PaidPill paid={entry.is_paid} s={s} />
                {entry.is_paid && entry.paid_at ? <Text style={s.tdMuted}>{formatDate(entry.paid_at)}</Text> : null}
              </View>
              <Text style={[s.td, s.right, s.semibold, { width: "11%" }]}>{formatCurrency(entry.total_amount)}</Text>
            </View>
          ))}

          <View style={s.tableFooter}>
            <Text style={[s.td, s.semibold, { width: "58%" }]}>Subtotal · {title.toLowerCase()}</Text>
            <Text style={[s.tdMuted, s.right, { width: "31%" }]}>
              pagos {formatCurrency(paid)} · a pagar {formatCurrency(Math.max(0, subtotal - paid))}
            </Text>
            <Text style={[s.td, s.right, s.semibold, { width: "11%" }]}>{formatCurrency(subtotal)}</Text>
          </View>
        </View>
      )}
    </>
  );
}

const PHOTO_GROUPS: { category: WorkAttachmentCategory; label: string }[] = [
  { category: "foto_antes", label: "Antes" },
  { category: "foto_durante", label: "Durante" },
  { category: "foto_depois", label: "Depois" },
];

function PhotosSection({ photos, accent, s }: { photos: WorkReportPhoto[]; accent: string; s: Styles }) {
  if (photos.length === 0) return <Text style={s.empty}>Nenhuma foto registrada.</Text>;

  return (
    <>
      {PHOTO_GROUPS.map((group) => {
        const groupPhotos = photos.filter((photo) => photo.category === group.category);
        if (groupPhotos.length === 0) return null;

        return (
          <View key={group.category} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }} minPresenceAhead={140}>
              <Text style={[s.pill, { color: accent, backgroundColor: tint(accent, 0.88) }]}>{group.label}</Text>
              <Text style={s.sectionCount}>
                {groupPhotos.length} {groupPhotos.length === 1 ? "foto" : "fotos"}
              </Text>
            </View>
            <View style={s.photoGrid}>
              {groupPhotos.map((photo, index) => (
                <View key={photo.id} style={s.photoCell} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image src={{ data: photo.image.data, format: photo.image.format }} style={s.photo} />
                  <Text style={s.photoCaption}>
                    {group.label} {index + 1}
                    {photo.caption ? ` · ${photo.caption}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

function InvoicesSection({ invoices, accent, s }: { invoices: WorkReportInvoice[]; accent: string; s: Styles }) {
  if (invoices.length === 0) return <Text style={s.empty}>Nenhuma nota fiscal ou comprovante anexado.</Text>;

  return (
    <>
      {invoices.map((invoice) => (
        <View key={invoice.id} style={s.invoiceCard} wrap={invoice.image === null ? false : undefined}>
          <View style={s.invoiceHead} minPresenceAhead={120}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Text style={[s.pill, { color: accent, backgroundColor: tint(accent, 0.88) }]}>
                {WORK_ATTACHMENT_CATEGORY_LABELS[invoice.category]}
              </Text>
              <Text style={[s.td, s.semibold]}>{invoice.fileName}</Text>
            </View>
            <Text style={s.tdMuted}>Enviado em {formatDate(invoice.createdAt)}</Text>
          </View>

          {invoice.entry || invoice.description ? (
            <View style={s.invoiceMeta}>
              {invoice.entry ? (
                <>
                  <View>
                    <Text style={s.factLabel}>Item vinculado</Text>
                    <Text style={s.factValue}>{invoice.entry.description}</Text>
                  </View>
                  <View>
                    <Text style={s.factLabel}>Valor</Text>
                    <Text style={[s.factValue, s.semibold]}>{formatCurrency(invoice.entry.totalAmount)}</Text>
                  </View>
                  <View>
                    <Text style={s.factLabel}>Pagamento</Text>
                    <Text style={[s.factValue, { color: invoice.entry.isPaid ? POSITIVE : WARNING }]}>
                      {invoice.entry.isPaid
                        ? `Pago${invoice.entry.paidAt ? ` em ${formatDate(invoice.entry.paidAt)}` : ""}`
                        : "A pagar"}
                    </Text>
                  </View>
                </>
              ) : null}
              {invoice.description ? (
                <View style={{ flexBasis: "100%" }}>
                  <Text style={s.factLabel}>Observação</Text>
                  <Text style={s.factValue}>{invoice.description}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {invoice.image ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={{ data: invoice.image.data, format: invoice.image.format }} style={s.invoiceImage} />
          ) : (
            <Text style={s.invoicePdfBox}>
              {invoice.appendixNumber
                ? `Documento em PDF — incluído na íntegra como Anexo ${invoice.appendixNumber}, ao final deste relatório.`
                : invoice.skipped
                  ? "Documento em PDF — não incluído por exceder o limite de páginas do relatório. Disponível no sistema."
                  : "Documento em PDF — disponível no sistema."}
            </Text>
          )}
        </View>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------------
// Relatório individual da obra
// -----------------------------------------------------------------------------

function WorkReport({ data, s }: { data: WorkReportData; s: Styles }) {
  const { branding, work, totals, entries } = data;
  const accent = branding.accentColor;
  const paidShare = totals.grandTotal > 0 ? Math.min(100, (totals.paidTotal / totals.grandTotal) * 100) : 0;
  const appendixCount = data.invoices.filter((invoice) => invoice.appendixNumber !== null).length;
  const recentActivities = data.activities.slice(0, 15);

  const facts: { label: string; value: string; wide?: boolean }[] = [
    { label: "Endereço", value: work.address, wide: true },
    { label: "Categoria", value: WORK_CATEGORY_LABELS[work.category] },
    { label: "Prioridade", value: WORK_PRIORITY_LABELS[work.priority] },
    { label: "Solicitação", value: work.requested_at ? formatDate(work.requested_at) : "—" },
    { label: "Início", value: work.started_at ? formatDate(work.started_at) : "—" },
    { label: "Previsão", value: work.expected_at ? formatDate(work.expected_at) : "—" },
    { label: "Conclusão", value: work.completed_at ? formatDate(work.completed_at) : "—" },
  ];

  return (
    <Document title={`Relatório da obra ${work.code}`} author={branding.organizationName}>
      <Page size="A4" style={s.page}>
        <TopBar branding={branding} right={`Relatório de obra · ${work.code}`} s={s} />

        {/* Capa ------------------------------------------------------------ */}
        <View style={[s.hero, { backgroundColor: accent }]}>
          <View style={s.heroRow}>
            <View style={{ flexShrink: 1, paddingRight: 12 }}>
              <Text style={s.heroEyebrow}>Relatório de obra · {work.code}</Text>
              <Text style={s.heroTitle}>{work.title}</Text>
              <Text style={s.heroSubtitle}>{work.property_label}</Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill status={work.status} s={s} />
              </View>
            </View>
            {branding.logoUrl ? (
              <View style={s.heroLogoBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={branding.logoUrl} style={s.heroLogo} />
              </View>
            ) : null}
          </View>
          <View style={s.heroMeta}>
            <View>
              <Text style={s.heroMetaLabel}>Proprietário</Text>
              <Text style={s.heroMetaValue}>{work.owner_label}</Text>
            </View>
            <View>
              <Text style={s.heroMetaLabel}>Responsável interno</Text>
              <Text style={s.heroMetaValue}>{work.responsible_name}</Text>
            </View>
            <View>
              <Text style={s.heroMetaLabel}>Emitido em</Text>
              <Text style={s.heroMetaValue}>{formatDateTime(new Date())}</Text>
            </View>
            <View>
              <Text style={s.heroMetaLabel}>Por</Text>
              <Text style={s.heroMetaValue}>{branding.generatedBy}</Text>
            </View>
          </View>
        </View>

        {/* KPIs ------------------------------------------------------------ */}
        <View style={s.kpiRow}>
          <Kpi label="Total geral" value={formatCurrency(totals.grandTotal)} color={accent} accentBorder={accent} s={s} />
          <Kpi label="Pago" value={formatCurrency(totals.paidTotal)} color={POSITIVE} hint={`${Math.round(paidShare)}% do total`} s={s} />
          <Kpi label="A pagar" value={formatCurrency(totals.unpaidTotal)} color={totals.unpaidTotal > 0 ? WARNING : INK} s={s} />
          <Kpi
            label="Itens"
            value={formatInteger(entries.length)}
            hint={`${data.photos.length} fotos · ${data.invoices.length} documentos`}
            s={s}
          />
        </View>
        {totals.grandTotal > 0 ? (
          <View style={[s.progressTrack, { marginTop: -4, marginBottom: 6 }]}>
            <View style={[s.progressFill, { width: `${paidShare}%`, backgroundColor: POSITIVE }]} />
          </View>
        ) : null}

        {/* Identificação --------------------------------------------------- */}
        <SectionHeader index="1" title="Identificação" accent={accent} s={s} />
        <View style={s.factsGrid}>
          {facts.map((fact) => (
            <View key={fact.label} style={fact.wide ? s.factWide : s.fact}>
              <Text style={s.factLabel}>{fact.label}</Text>
              <Text style={s.factValue}>{fact.value}</Text>
            </View>
          ))}
        </View>

        <SectionHeader index="2" title="Descrição" accent={accent} s={s} />
        <Text style={s.paragraphBox}>{work.description}</Text>
        {work.notes ? (
          <View style={{ marginTop: 6 }}>
            <Text style={s.factLabel}>Observações</Text>
            <Text style={[s.factValue, { lineHeight: 1.4 }]}>{work.notes}</Text>
          </View>
        ) : null}

        {/* Custos ---------------------------------------------------------- */}
        <EntriesTable entries={entries} type="servico" index="3" title="Serviços" accent={accent} s={s} />
        <EntriesTable entries={entries} type="material" index="4" title="Materiais" accent={accent} s={s} />
        <EntriesTable entries={entries} type="outro_custo" index="5" title="Outros custos" accent={accent} s={s} />

        <SectionHeader index="6" title="Resumo financeiro" accent={accent} s={s} />
        <View style={s.table} wrap={false}>
          {[
            { label: "Serviços", value: totals.servicesTotal },
            { label: "Materiais", value: totals.materialsTotal },
            { label: "Outros custos", value: totals.otherTotal },
          ].map((row, index) => (
            <View key={row.label} style={[s.tableRow, index % 2 === 1 ? s.tableRowAlt : {}]}>
              <Text style={[s.td, { width: "70%" }]}>{row.label}</Text>
              <Text style={[s.td, s.right, { width: "30%" }]}>{formatCurrency(row.value)}</Text>
            </View>
          ))}
          <View style={s.tableFooter}>
            <Text style={[s.td, s.semibold, { width: "70%" }]}>Total geral</Text>
            <Text style={[s.td, s.right, s.semibold, { width: "30%", color: accent }]}>{formatCurrency(totals.grandTotal)}</Text>
          </View>
          <View style={s.tableRow}>
            <Text style={[s.td, { width: "70%", color: POSITIVE }]}>Pago</Text>
            <Text style={[s.td, s.right, { width: "30%", color: POSITIVE }]}>{formatCurrency(totals.paidTotal)}</Text>
          </View>
          <View style={[s.tableRow, { borderBottomWidth: 0 }]}>
            <Text style={[s.td, { width: "70%", color: WARNING }]}>A pagar</Text>
            <Text style={[s.td, s.right, { width: "30%", color: WARNING }]}>{formatCurrency(totals.unpaidTotal)}</Text>
          </View>
        </View>

        {/* Fotos ----------------------------------------------------------- */}
        <SectionHeader
          index="7"
          title="Fotos da obra"
          count={`${data.photos.length} ${data.photos.length === 1 ? "foto" : "fotos"}`}
          accent={accent}
          s={s}
          breakBefore={data.photos.length > 0}
        />
        <PhotosSection photos={data.photos} accent={accent} s={s} />

        {/* Notas fiscais --------------------------------------------------- */}
        <SectionHeader
          index="8"
          title="Notas fiscais e comprovantes"
          count={`${data.invoices.length} ${data.invoices.length === 1 ? "documento" : "documentos"}${appendixCount > 0 ? ` · ${appendixCount} em anexo` : ""}`}
          accent={accent}
          s={s}
          breakBefore={data.invoices.length > 0}
        />
        <InvoicesSection invoices={data.invoices} accent={accent} s={s} />

        {/* Histórico ------------------------------------------------------- */}
        {recentActivities.length > 0 ? (
          <>
            <SectionHeader index="9" title="Histórico recente" count={`últimas ${recentActivities.length}`} accent={accent} s={s} />
            <View>
              {recentActivities.map((activity) => (
                <View key={activity.id} style={s.activityRow} wrap={false}>
                  <Text style={s.activityDate}>{formatDateTime(activity.created_at)}</Text>
                  <Text style={s.activityText}>{activity.description}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {appendixCount > 0 ? (
          <Text style={[s.tdMuted, { marginTop: 14, textAlign: "center" }]}>
            As páginas seguintes reproduzem os {appendixCount === 1 ? "documento anexado" : `${appendixCount} documentos anexados`} em PDF.
          </Text>
        ) : null}

        <ReportFooter branding={branding} left={`Obra ${work.code} · ${work.title}`} s={s} />
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------------------
// Relatório geral (lista de obras)
// -----------------------------------------------------------------------------

function WorksListReport({ data, s }: { data: WorksListReportData; s: Styles }) {
  const { branding, rows } = data;
  const accent = branding.accentColor;
  const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const paidTotal = rows.reduce((sum, row) => sum + row.paidAmount, 0);

  return (
    <Document title="Relatório geral de obras" author={branding.organizationName}>
      <Page size="A4" style={s.page} orientation="landscape">
        <TopBar branding={branding} right="Relatório geral de obras" s={s} />

        <View style={[s.hero, { backgroundColor: accent, padding: 14 }]}>
          <View style={s.heroRow}>
            <View>
              <Text style={s.heroEyebrow}>Obras · {data.periodLabel}</Text>
              <Text style={[s.heroTitle, { fontSize: 16 }]}>Relatório geral de obras</Text>
              <Text style={s.heroSubtitle}>{data.filters.join("  ·  ")}</Text>
            </View>
            {branding.logoUrl ? (
              <View style={s.heroLogoBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={branding.logoUrl} style={s.heroLogo} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.kpiRow}>
          <Kpi label="Obras" value={formatInteger(rows.length)} s={s} />
          <Kpi label="Gasto total" value={formatCurrency(grandTotal)} color={accent} accentBorder={accent} s={s} />
          <Kpi label="Pago" value={formatCurrency(paidTotal)} color={POSITIVE} s={s} />
          <Kpi label="A pagar" value={formatCurrency(Math.max(0, grandTotal - paidTotal))} color={WARNING} s={s} />
        </View>

        {rows.length === 0 ? (
          <Text style={s.empty}>Nenhuma obra encontrada para os filtros selecionados.</Text>
        ) : (
          <View style={s.table}>
            <View style={s.tableHeader} fixed>
              <Text style={[s.th, { width: "10%" }]}>Código</Text>
              <Text style={[s.th, { width: "25%" }]}>Título</Text>
              <Text style={[s.th, { width: "19%" }]}>Imóvel</Text>
              <Text style={[s.th, { width: "12%" }]}>Status</Text>
              <Text style={[s.th, { width: "8%" }]}>Início</Text>
              <Text style={[s.th, s.right, { width: "9%" }]}>Total</Text>
              <Text style={[s.th, s.right, { width: "8.5%" }]}>Pago</Text>
              <Text style={[s.th, s.right, { width: "8.5%" }]}>A pagar</Text>
            </View>

            {rows.map((row, index) => (
              <View key={row.code} style={[s.tableRow, index % 2 === 1 ? s.tableRowAlt : {}]} wrap={false}>
                <Text style={[s.td, { width: "10%" }]}>{row.code}</Text>
                <Text style={[s.td, { width: "25%", paddingRight: 6 }]}>{row.title}</Text>
                <Text style={[s.td, { width: "19%", paddingRight: 6 }]}>{row.propertyLabel}</Text>
                <View style={{ width: "12%" }}>
                  <StatusPill status={row.status} s={s} />
                </View>
                <Text style={[s.td, { width: "8%" }]}>{row.startedAt ? formatDate(row.startedAt) : "—"}</Text>
                <Text style={[s.td, s.right, s.semibold, { width: "9%" }]}>{formatCurrency(row.totalAmount)}</Text>
                <Text style={[s.td, s.right, { width: "8.5%", color: POSITIVE }]}>{formatCurrency(row.paidAmount)}</Text>
                <Text style={[s.td, s.right, { width: "8.5%", color: WARNING }]}>
                  {formatCurrency(Math.max(0, row.totalAmount - row.paidAmount))}
                </Text>
              </View>
            ))}

            <View style={s.tableFooter}>
              <Text style={[s.td, s.semibold, { width: "74%" }]}>Total geral</Text>
              <Text style={[s.td, s.right, s.semibold, { width: "9%" }]}>{formatCurrency(grandTotal)}</Text>
              <Text style={[s.td, s.right, s.semibold, { width: "8.5%", color: POSITIVE }]}>{formatCurrency(paidTotal)}</Text>
              <Text style={[s.td, s.right, s.semibold, { width: "8.5%", color: WARNING }]}>
                {formatCurrency(Math.max(0, grandTotal - paidTotal))}
              </Text>
            </View>
          </View>
        )}

        <ReportFooter branding={branding} left={`Gerado por ${branding.generatedBy} em ${formatDateTime(new Date())}`} s={s} />
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------------------
// Renderização
// -----------------------------------------------------------------------------

function stylesForCurrentFont(): Styles {
  return buildStyles(ensureWorkReportFont());
}

export async function renderWorkReport(data: WorkReportData): Promise<Buffer> {
  return renderToBuffer(<WorkReport data={data} s={stylesForCurrentFont()} />);
}

export async function renderWorksListReport(data: WorksListReportData): Promise<Buffer> {
  return renderToBuffer(<WorksListReport data={data} s={stylesForCurrentFont()} />);
}
