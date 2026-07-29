/**
 * Normalização dos dados da planilha antiga.
 *
 * A planilha `CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx` guarda os mesmos campos em
 * formatos diferentes de linha para linha — ver docs/IMPORT_GUIDE.md:
 *
 *   percentuais   0.05 · "5%" · 6% · 6 · "40%"
 *   dinheiro      500000 · "R$ 500.000,00" · "500.000,00"
 *   corretores    "Marcos Fábio " · "marcos fábio" · "  Leonardo Farias"
 *
 * Nada é aproveitado das células de total ou de fórmula consolidada: tudo é
 * recalculado pelo motor financeiro depois da importação.
 */

import { parseCurrencyInput } from "@/lib/formatting/number";

export interface NormalizedPercent {
  /** Percentual em pontos percentuais (6% => 6). */
  value: number | null;
  /** true quando o valor estava como fração decimal (0,06) e foi convertido. */
  convertedFromFraction: boolean;
}

/**
 * Converte qualquer representação de percentual da planilha para pontos
 * percentuais.
 *
 * Regra da ambiguidade: valores numéricos entre 0 e 1 (inclusive) são tratados
 * como fração e multiplicados por 100 — é assim que a planilha grava 5% como
 * 0,05 e 100% como 1. A conversão é sinalizada na prévia para revisão humana.
 */
export function normalizeSpreadsheetPercent(input: unknown): NormalizedPercent {
  if (input === null || input === undefined || input === "") {
    return { value: null, convertedFromFraction: false };
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { value: null, convertedFromFraction: false };
    if (input > 0 && input <= 1) {
      return { value: roundPercent(input * 100), convertedFromFraction: true };
    }
    return { value: roundPercent(input), convertedFromFraction: false };
  }

  const text = String(input).trim();
  if (text === "") return { value: null, convertedFromFraction: false };

  const hadPercentSign = text.includes("%");
  const parsed = parseCurrencyInput(text.replace(/%/g, ""));

  if (parsed === null) return { value: null, convertedFromFraction: false };

  // "5%" já está em pontos percentuais; "0,05" precisa ser convertido.
  if (hadPercentSign) return { value: roundPercent(parsed), convertedFromFraction: false };

  if (parsed > 0 && parsed <= 1) {
    return { value: roundPercent(parsed * 100), convertedFromFraction: true };
  }

  return { value: roundPercent(parsed), convertedFromFraction: false };
}

function roundPercent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Converte qualquer representação monetária da planilha para número. */
export function normalizeSpreadsheetMoney(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100) / 100;
  }

  const parsed = parseCurrencyInput(String(input));
  if (parsed === null) return null;
  return Math.round(parsed * 100) / 100;
}

/**
 * Normaliza o nome do corretor: remove espaços duplicados e das pontas.
 * A capitalização original é preservada — apenas a COMPARAÇÃO é feita sem
 * diferenciar maiúsculas de minúsculas.
 */
export function normalizeBrokerName(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/\s+/g, " ").trim();
}

/** Chave de comparação de nomes, sem acento e sem diferenciar caixa. */
export function brokerNameKey(input: unknown): string {
  return normalizeBrokerName(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const TOTALS_MARKERS = [
  "total",
  "totais",
  "subtotal",
  "soma",
  "resumo",
  "media",
  "média",
  "consolidado",
];

/** Identifica linhas de total/consolidação, que nunca devem ser importadas. */
export function isTotalsRow(text: unknown): boolean {
  const value = brokerNameKey(text);
  if (value === "") return false;
  return TOTALS_MARKERS.some((marker) => value.startsWith(marker));
}

/** Tipo de imóvel na planilha ("Residencial"/"Comercial"). */
export function normalizePropertyType(input: unknown): "residential" | "commercial" {
  return brokerNameKey(input).startsWith("comercial") ? "commercial" : "residential";
}

const MONTH_SHEETS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/**
 * Identifica abas mensais pelo nome. Abas de configuração, dashboard e
 * relatório são ignoradas.
 */
export function monthFromSheetName(sheetName: string): number | null {
  const key = brokerNameKey(sheetName).replace(/[^a-z]/g, "");
  return MONTH_SHEETS[key] ?? null;
}
