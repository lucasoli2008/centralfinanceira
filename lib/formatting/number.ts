/**
 * Formatação e normalização de números no padrão brasileiro.
 *
 * O banco sempre armazena números normalizados — nunca texto formatado.
 */

const LOCALE = "pt-BR";
const CURRENCY = "BRL";

const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  notation: "compact",
  maximumFractionDigits: 1,
});

const decimalFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** R$ 500.000,00 */
export function formatCurrency(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return currencyFormatter.format(numeric);
}

/**
 * Partes de um valor monetário, para renderizar com hierarquia tipográfica
 * (símbolo e centavos menores que os reais) — ver components/finance/money.tsx.
 */
export function currencyParts(
  value: number | string | null | undefined,
): { negative: boolean; integer: string; cents: string } | null {
  const numeric = toNumber(value);
  if (numeric === null) return null;

  const formatted = decimalFormatter.format(Math.abs(numeric));
  const [integer, cents = "00"] = formatted.split(",");

  return { negative: numeric < 0, integer, cents };
}

/** R$ 500 mil — usado apenas em eixos de gráficos. */
export function formatCompactCurrency(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return compactCurrencyFormatter.format(numeric);
}

export function formatDecimal(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return decimalFormatter.format(numeric);
}

/** 6% · 5,5% · 40% — valores em pontos percentuais. */
export function formatPercent(
  value: number | string | null | undefined,
  { maximumFractionDigits = 2 }: { maximumFractionDigits?: number } = {},
): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return `${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(numeric)}%`;
}

/** +12,5% / −8,3% — variações entre períodos. */
export function formatVariation(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
  return `${formatted}%`.replace("-", "−");
}

export function formatInteger(value: number | string | null | undefined): string {
  const numeric = toNumber(value);
  if (numeric === null) return "—";
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(numeric);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Normaliza entrada monetária digitada por pessoas.
 *
 * Aceita: 500000 · 500.000 · 500.000,00 · R$ 500.000,00 · 1234,56 · 1.234,56
 *
 * Heurística para o ponto isolado (sem vírgula):
 *   - mais de um ponto            -> separador de milhar  (1.234.567 => 1234567)
 *   - um ponto seguido de 3 dígitos -> separador de milhar (500.000 => 500000)
 *   - caso contrário             -> separador decimal      (500.5 => 500.5)
 */
export function parseCurrencyInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const cleaned = input
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d.,-]/g, "");

  if (cleaned === "" || cleaned === "-") return null;

  const negative = cleaned.startsWith("-");
  const digitsOnly = cleaned.replace(/-/g, "");
  const hasComma = digitsOnly.includes(",");
  const dotCount = (digitsOnly.match(/\./g) ?? []).length;

  let normalized: string;

  if (hasComma) {
    // Vírgula é sempre o separador decimal no padrão brasileiro.
    normalized = digitsOnly.replace(/\./g, "").replace(",", ".");
  } else if (dotCount === 0) {
    normalized = digitsOnly;
  } else if (dotCount > 1) {
    normalized = digitsOnly.replace(/\./g, "");
  } else {
    const [, decimals = ""] = digitsOnly.split(".");
    normalized = decimals.length === 3 ? digitsOnly.replace(".", "") : digitsOnly;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * Normaliza percentual digitado. Retorna pontos percentuais: "5,5%" => 5.5
 */
export function parsePercentInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const cleaned = input.replace(/\s/g, "").replace(/%/g, "");
  if (cleaned === "") return null;
  return parseCurrencyInput(cleaned);
}

/** Máscara aplicada enquanto o usuário digita valores monetários. */
export function maskCurrencyInput(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits === "") return "";
  const numeric = Number(digits) / 100;
  return decimalFormatter.format(numeric);
}

/** Verifica se o valor tem no máximo duas casas decimais depois de normalizado. */
export function hasValidMoneyPrecision(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
