import "server-only";

import ExcelJS from "exceljs";
import {
  brokerNameKey,
  isTotalsRow,
  monthFromSheetName,
  normalizeBrokerName,
  normalizePropertyType,
  normalizeSpreadsheetMoney,
  normalizeSpreadsheetPercent,
} from "@/lib/import/normalize";
import { calculateEntryTotals } from "@/lib/finance/engine";
import type { EntryType, PropertyType } from "@/lib/finance/types";

/**
 * Leitura da planilha antiga.
 *
 * Regras (docs/IMPORT_GUIDE.md):
 *   • só abas mensais entram (Config, Dashboard e Relatório são ignoradas);
 *   • cabeçalho é detectado por texto, não por posição fixa;
 *   • linhas vazias, de total e de fórmula consolidada são descartadas;
 *   • nenhum total da planilha é aproveitado — tudo é recalculado aqui.
 */

export interface ImportRowDraft {
  id: string;
  sheet: string;
  month: number;
  sourceRow: number;
  entryDate: string;
  description: string;
  reference: string | null;
  propertyType: PropertyType;
  baseAmount: number;
  commissionRate: number | null;
  brokerName: string | null;
  splitRate: number | null;
  warnings: string[];
  grossCommission: number;
  brokerPayout: number;
  netRevenue: number;
}

export interface ImportSkippedRow {
  sheet: string;
  sourceRow: number;
  reason: string;
}

export interface ImportBrokerMatch {
  name: string;
  key: string;
  rowCount: number;
  existingBrokerId: string | null;
  existingBrokerName: string | null;
}

export interface ImportPreview {
  filename: string;
  year: number;
  entryType: EntryType;
  sheetsDetected: { name: string; month: number; rows: number }[];
  sheetsIgnored: string[];
  rows: ImportRowDraft[];
  skipped: ImportSkippedRow[];
  brokers: ImportBrokerMatch[];
  totals: { grossCommission: number; brokerPayout: number; netRevenue: number; entries: number };
}

type CellValue = ExcelJS.CellValue;

/** Extrai o valor útil de uma célula, ignorando fórmulas e texto rico. */
function cellValue(value: CellValue): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    if ("result" in value) return (value as ExcelJS.CellFormulaValue).result ?? null;
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join("");
    }
    if ("text" in value) return (value as ExcelJS.CellHyperlinkValue).text;
    if (value instanceof Date) return value;
    return null;
  }

  return value;
}

function cellText(value: CellValue): string {
  const raw = cellValue(value);
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

interface ColumnMap {
  description?: number;
  propertyType?: number;
  broker?: number;
  baseAmount?: number;
  commissionRate?: number;
  splitRate?: number;
  reference?: number;
  entryDate?: number;
}

/**
 * Detecta o cabeçalho pelo conteúdo. Retorna a linha e o mapa de colunas.
 * A ordem dos testes importa: "% Corretor" não pode ser confundido com
 * "Corretor", nem "Repasse Corretor" com o percentual.
 */
function detectHeader(sheet: ExcelJS.Worksheet): { row: number; columns: ColumnMap } | null {
  const maxRow = Math.min(sheet.rowCount, 25);

  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const columns: ColumnMap = {};
    let matches = 0;

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = brokerNameKey(cellText(cell.value)).replace(/\s+/g, " ");
      if (!header) return;

      const isPercent = header.startsWith("%") || header.includes("percentual");

      if (/valor da venda|valor do imovel|valor total|primeiro aluguel|valor do aluguel/.test(header)) {
        columns.baseAmount ??= columnNumber;
        matches++;
      } else if (isPercent && /comissao/.test(header)) {
        columns.commissionRate ??= columnNumber;
        matches++;
      } else if (isPercent && /corretor/.test(header)) {
        columns.splitRate ??= columnNumber;
        matches++;
      } else if (/^corretor|corretor responsavel|vendedor/.test(header) && !/repasse|%/.test(header)) {
        columns.broker ??= columnNumber;
        matches++;
      } else if (/imovel|endereco|descricao|cliente|operacao/.test(header)) {
        columns.description ??= columnNumber;
        matches++;
      } else if (/^tipo/.test(header)) {
        columns.propertyType ??= columnNumber;
        matches++;
      } else if (/referencia|contrato|codigo/.test(header)) {
        columns.reference ??= columnNumber;
      } else if (/^data/.test(header)) {
        columns.entryDate ??= columnNumber;
      }
    });

    // Um cabeçalho válido precisa, no mínimo, do valor-base e de uma descrição.
    if (matches >= 2 && columns.baseAmount && columns.description) {
      return { row: rowNumber, columns };
    }
  }

  return null;
}

/**
 * Linhas de total nem sempre trazem o rótulo na coluna de descrição — na
 * planilha real ele fica na coluna do número da linha. Por isso a checagem
 * varre todas as células de texto da linha.
 */
function rowHasTotalsMarker(row: ExcelJS.Row): boolean {
  let found = false;

  row.eachCell({ includeEmpty: false }, (cell) => {
    if (found) return;
    const text = cellText(cell.value);
    if (text && isTotalsRow(text)) found = true;
  });

  return found;
}

function isoDate(year: number, month: number, day: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export interface ParseOptions {
  filename: string;
  /** Ano financeiro das abas mensais — a planilha não guarda o ano. */
  year: number;
  /** Dia usado na data da entrada, já que a planilha não tem coluna de data. */
  dayOfMonth?: number;
  entryType?: EntryType;
  /** Corretores já cadastrados, para casar nomes sem duplicar. */
  existingBrokers: { id: string; full_name: string }[];
}

export async function parseSpreadsheet(
  buffer: ArrayBuffer,
  options: ParseOptions,
): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const entryType: EntryType = options.entryType ?? "sale";
  const dayOfMonth = options.dayOfMonth ?? 1;

  const rows: ImportRowDraft[] = [];
  const skipped: ImportSkippedRow[] = [];
  const sheetsDetected: { name: string; month: number; rows: number }[] = [];
  const sheetsIgnored: string[] = [];
  const brokerCounts = new Map<string, { name: string; count: number }>();

  for (const sheet of workbook.worksheets) {
    const month = monthFromSheetName(sheet.name);

    if (month === null) {
      sheetsIgnored.push(sheet.name);
      continue;
    }

    const header = detectHeader(sheet);

    if (!header) {
      sheetsIgnored.push(sheet.name);
      skipped.push({
        sheet: sheet.name,
        sourceRow: 0,
        reason: "Não foi possível identificar o cabeçalho desta aba.",
      });
      continue;
    }

    let sheetRows = 0;

    for (let rowNumber = header.row + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const description = cellText(row.getCell(header.columns.description!).value);
      const rawBase = cellValue(row.getCell(header.columns.baseAmount!).value);
      const baseAmount = normalizeSpreadsheetMoney(rawBase);

      // Linhas vazias são simplesmente ignoradas, sem poluir o relatório.
      if (!description && (baseAmount === null || baseAmount === 0)) continue;

      if (isTotalsRow(description) || rowHasTotalsMarker(row)) {
        skipped.push({ sheet: sheet.name, sourceRow: rowNumber, reason: "Linha de totais." });
        continue;
      }

      if (!description) {
        skipped.push({
          sheet: sheet.name,
          sourceRow: rowNumber,
          reason: "Linha sem descrição do imóvel.",
        });
        continue;
      }

      if (baseAmount === null || baseAmount <= 0) {
        skipped.push({
          sheet: sheet.name,
          sourceRow: rowNumber,
          reason: "Linha sem valor-base válido.",
        });
        continue;
      }

      const warnings: string[] = [];

      const commission = normalizeSpreadsheetPercent(
        header.columns.commissionRate
          ? cellValue(row.getCell(header.columns.commissionRate).value)
          : null,
      );

      if (commission.convertedFromFraction) {
        warnings.push("Percentual da comissão estava como fração e foi convertido.");
      }

      if (commission.value === null) {
        warnings.push("Sem percentual de comissão na planilha — revise antes de confirmar.");
      }

      const split = normalizeSpreadsheetPercent(
        header.columns.splitRate ? cellValue(row.getCell(header.columns.splitRate).value) : null,
      );

      if (split.convertedFromFraction) {
        warnings.push("Percentual do corretor estava como fração e foi convertido.");
      }

      const brokerName = header.columns.broker
        ? normalizeBrokerName(cellText(row.getCell(header.columns.broker).value))
        : "";

      if (brokerName && split.value === null) {
        warnings.push("Corretor informado sem percentual de repasse.");
      }

      if (!brokerName && split.value !== null) {
        warnings.push("Percentual de repasse sem corretor — o repasse será ignorado.");
      }

      const hasSplit = Boolean(brokerName) && split.value !== null;

      const totals = calculateEntryTotals(
        { mode: "percentage", baseAmount, rate: commission.value ?? 0 },
        hasSplit ? [{ mode: "percentage", rate: split.value }] : [],
      );

      if (totals.isNegativeNet) {
        warnings.push("O repasse supera a comissão bruta nesta linha.");
      }

      // A planilha não tem coluna de data: usamos o mês da aba com o ano
      // informado pelo administrador.
      const explicitDate = header.columns.entryDate
        ? cellValue(row.getCell(header.columns.entryDate).value)
        : null;

      const entryDate =
        explicitDate instanceof Date
          ? explicitDate.toISOString().slice(0, 10)
          : isoDate(options.year, month, dayOfMonth);

      if (brokerName) {
        const key = brokerNameKey(brokerName);
        const current = brokerCounts.get(key);
        if (current) current.count++;
        else brokerCounts.set(key, { name: brokerName, count: 1 });
      }

      rows.push({
        id: `${sheet.name}!${rowNumber}`,
        sheet: sheet.name,
        month,
        sourceRow: rowNumber,
        entryDate,
        description,
        reference: header.columns.reference
          ? cellText(row.getCell(header.columns.reference).value) || null
          : null,
        propertyType: header.columns.propertyType
          ? normalizePropertyType(cellText(row.getCell(header.columns.propertyType).value))
          : "residential",
        baseAmount,
        commissionRate: commission.value,
        brokerName: brokerName || null,
        splitRate: hasSplit ? split.value : null,
        warnings,
        grossCommission: totals.grossCommission,
        brokerPayout: totals.totalBrokerPayout,
        netRevenue: totals.netCompanyRevenue,
      });

      sheetRows++;
    }

    sheetsDetected.push({ name: sheet.name, month, rows: sheetRows });
  }

  const existingByKey = new Map(
    options.existingBrokers.map((broker) => [brokerNameKey(broker.full_name), broker]),
  );

  const brokers: ImportBrokerMatch[] = Array.from(brokerCounts.entries())
    .map(([key, value]) => {
      const existing = existingByKey.get(key);
      return {
        name: value.name,
        key,
        rowCount: value.count,
        existingBrokerId: existing?.id ?? null,
        existingBrokerName: existing?.full_name ?? null,
      };
    })
    .sort((a, b) => b.rowCount - a.rowCount);

  const totals = rows.reduce(
    (accumulator, row) => ({
      grossCommission: accumulator.grossCommission + row.grossCommission,
      brokerPayout: accumulator.brokerPayout + row.brokerPayout,
      netRevenue: accumulator.netRevenue + row.netRevenue,
      entries: accumulator.entries + 1,
    }),
    { grossCommission: 0, brokerPayout: 0, netRevenue: 0, entries: 0 },
  );

  return {
    filename: options.filename,
    year: options.year,
    entryType,
    sheetsDetected: sheetsDetected.sort((a, b) => a.month - b.month),
    sheetsIgnored,
    rows,
    skipped,
    brokers,
    totals: {
      grossCommission: Math.round(totals.grossCommission * 100) / 100,
      brokerPayout: Math.round(totals.brokerPayout * 100) / 100,
      netRevenue: Math.round(totals.netRevenue * 100) / 100,
      entries: totals.entries,
    },
  };
}
