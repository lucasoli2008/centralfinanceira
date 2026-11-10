import ExcelJS from "exceljs";
import { FIN_ENTRY_KIND_LABELS, FIN_ENTRY_STATUS_LABELS } from "@/lib/formatting/labels";
import type { DreSection, DreStatement, DreValues } from "@/lib/finance/dre";
import type { FinCashProjectionRow, FinEntryDetailRow } from "@/types/database";

/**
 * Planilhas do Controle Financeiro. Recebem os MESMOS dados das telas
 * (getDre, getCashProjection, listFinEntries) — nenhum valor é recalculado aqui.
 */

const MONEY = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F4" } };

function workbook(organizationName: string) {
  const book = new ExcelJS.Workbook();
  book.creator = organizationName;
  book.created = new Date();
  return book;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle" };
}

function titleRows(sheet: ExcelJS.Worksheet, title: string, subtitle: string) {
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([subtitle]).font = { color: { argb: "FF57534E" } };
  sheet.addRow([]);
}

function isoToDate(value: string | null) {
  return value ? new Date(`${value}T12:00:00Z`) : null;
}

// -----------------------------------------------------------------------------
// DRE
// -----------------------------------------------------------------------------
function addDreLines(
  sheet: ExcelJS.Worksheet,
  periods: string[],
  label: string,
  values: DreValues,
  level: 0 | 1 | 2,
  bold = false,
) {
  const row = sheet.addRow([label, ...periods.map((period) => values.byPeriod[period] ?? 0), values.total]);
  row.getCell(1).alignment = { indent: level * 2 };
  if (bold) row.font = { bold: true };
  return row;
}

function addSection(sheet: ExcelJS.Worksheet, periods: string[], section: DreSection) {
  const row = addDreLines(sheet, periods, section.label, section, 0, true);
  row.fill = HEADER_FILL;
  for (const group of section.groups) {
    addDreLines(sheet, periods, group.name, group, 1);
    if (group.categories.length > 1 || group.categories[0]?.name !== group.name) {
      for (const category of group.categories) addDreLines(sheet, periods, category.name, category, 2);
    }
  }
}

export async function buildDreWorkbook(dre: DreStatement, organizationName: string, subtitle: string): Promise<Buffer> {
  const book = workbook(organizationName);
  const sheet = book.addWorksheet("DRE gerencial", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
  titleRows(sheet, `DRE gerencial — ${organizationName}`, subtitle);

  const periods = dre.periods.length > 1 ? dre.periods : [];
  styleHeader(sheet.addRow(["Linha", ...periods.map((period) => period.split("-").reverse().join("/")), "Total"]));

  for (const item of dre.rows) {
    if (item.type === "section") addSection(sheet, periods, item.section);
    else addDreLines(sheet, periods, item.subtotal.label, item.subtotal, 0, true).border = { top: { style: "thin" } };
  }
  const margin = sheet.addRow([
    "Margem líquida (%)",
    ...periods.map((period) => dre.netMargin[period] ?? null),
    dre.netMargin.total,
  ]);
  margin.font = { italic: true };

  if (dre.memo.length) {
    sheet.addRow([]);
    sheet.addRow(["Fora do resultado (memória) — valores de terceiros, cauções e sócios"]).font = { bold: true };
    for (const section of dre.memo) addSection(sheet, periods, section);
  }

  sheet.getColumn(1).width = 52;
  for (let index = 2; index <= periods.length + 2; index++) {
    const column = sheet.getColumn(index);
    column.width = 15;
    column.numFmt = MONEY;
  }
  margin.eachCell((cell, column) => {
    if (column > 1) cell.numFmt = '0.00"%"';
  });

  return Buffer.from(await book.xlsx.writeBuffer());
}

// -----------------------------------------------------------------------------
// Fluxo projetado
// -----------------------------------------------------------------------------
export async function buildProjectionWorkbook(rows: FinCashProjectionRow[], organizationName: string, subtitle: string): Promise<Buffer> {
  const book = workbook(organizationName);
  const sheet = book.addWorksheet("Fluxo projetado", { views: [{ state: "frozen", ySplit: 4 }] });
  titleRows(sheet, `Fluxo de caixa projetado — ${organizationName}`, subtitle);
  styleHeader(
    sheet.addRow(["Início", "Fim", "Saldo inicial", "Entradas", "Saídas", "Das quais a terceiros", "Entradas previstas", "Saídas previstas", "Saldo final"]),
  );
  for (const row of rows) {
    sheet.addRow([
      row.bucket_start ? isoToDate(row.bucket_start) : "Vencidos",
      isoToDate(row.bucket_end),
      row.opening_balance,
      row.inflow,
      row.outflow,
      row.third_party_out,
      row.forecast_in,
      row.forecast_out,
      row.closing_balance,
    ]);
  }
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(1).numFmt = "dd/mm/yyyy";
  sheet.getColumn(2).numFmt = "dd/mm/yyyy";
  for (let index = 3; index <= 9; index++) {
    sheet.getColumn(index).width = 17;
    sheet.getColumn(index).numFmt = MONEY;
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

// -----------------------------------------------------------------------------
// Lançamentos
// -----------------------------------------------------------------------------
export async function buildEntriesWorkbook(rows: FinEntryDetailRow[], organizationName: string, subtitle: string): Promise<Buffer> {
  const book = workbook(organizationName);
  const sheet = book.addWorksheet("Lançamentos", { views: [{ state: "frozen", ySplit: 4 }] });
  titleRows(sheet, `Lançamentos — ${organizationName}`, subtitle);
  styleHeader(
    sheet.addRow([
      "Competência",
      "Vencimento",
      "Tipo",
      "Descrição",
      "Grupo",
      "Categoria",
      "Conta",
      "Favorecido",
      "Centro de custo",
      "Imóvel",
      "Situação",
      "Valor",
      "Baixado",
      "Em aberto",
      "Documento",
    ]),
  );
  for (const row of rows) {
    const signed = row.kind === "expense" ? -row.amount : row.amount;
    sheet.addRow([
      isoToDate(row.competence_date),
      isoToDate(row.due_date),
      FIN_ENTRY_KIND_LABELS[row.kind],
      row.description,
      row.category_parent_name,
      row.category_name,
      row.kind === "transfer" ? `${row.account_name ?? ""} → ${row.transfer_account_name ?? ""}` : row.account_name,
      row.counterparty_name,
      row.cost_center_name,
      row.property_label,
      FIN_ENTRY_STATUS_LABELS[row.status],
      signed,
      row.settled_amount,
      row.remaining_amount,
      row.document_number,
    ]);
  }
  const widths = [12, 12, 13, 40, 22, 26, 22, 26, 18, 22, 13, 15, 15, 15, 14];
  widths.forEach((width, index) => (sheet.getColumn(index + 1).width = width));
  sheet.getColumn(1).numFmt = "dd/mm/yyyy";
  sheet.getColumn(2).numFmt = "dd/mm/yyyy";
  for (const index of [12, 13, 14]) sheet.getColumn(index).numFmt = MONEY;
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: widths.length } };
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function xlsxResponse(buffer: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
