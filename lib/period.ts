/**
 * Filtro global de período.
 *
 * Um único lugar decide o intervalo consultado, o rótulo exibido e o período
 * anterior equivalente usado nas comparações — dashboard, listas, visão mensal,
 * relatórios e PDFs usam exatamente estas regras.
 */

import { addMonths, firstDayOfMonth, formatMonthYear, lastDayOfMonth, parseISODate, todayInTimezone } from "@/lib/formatting/date";

export const PERIOD_PRESETS = [
  "este-mes",
  "mes-anterior",
  "ultimos-3-meses",
  "ultimos-6-meses",
  "ano-atual",
  "ano-anterior",
  "mes",
  "personalizado",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  "este-mes": "Este mês",
  "mes-anterior": "Mês anterior",
  "ultimos-3-meses": "Últimos 3 meses",
  "ultimos-6-meses": "Últimos 6 meses",
  "ano-atual": "Ano atual",
  "ano-anterior": "Ano anterior",
  mes: "Mês específico",
  personalizado: "Período personalizado",
};

export interface PeriodRange {
  preset: PeriodPreset;
  from: string;
  to: string;
  label: string;
  /** Período anterior equivalente; null quando não faz sentido comparar. */
  previous: { from: string; to: string; label: string } | null;
}

export interface PeriodParams {
  periodo?: string;
  de?: string;
  ate?: string;
  ano?: string;
  mes?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPreset(value: string | undefined): value is PeriodPreset {
  return !!value && (PERIOD_PRESETS as readonly string[]).includes(value);
}

function monthRange(year: number, month: number) {
  return { from: firstDayOfMonth(year, month), to: lastDayOfMonth(year, month) };
}

function daysBetween(from: string, to: string): number {
  const diff = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.round(diff / 86_400_000);
}

function shiftDays(date: string, days: number): string {
  const value = parseISODate(date);
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolve o período a partir dos parâmetros da URL.
 * O padrão é "Este mês", calculado no fuso da imobiliária.
 */
export function resolvePeriod(params: PeriodParams = {}, today = todayInTimezone()): PeriodRange {
  const reference = parseISODate(today);
  const currentYear = reference.getFullYear();
  const currentMonth = reference.getMonth() + 1;

  const preset: PeriodPreset = isPreset(params.periodo) ? params.periodo : "este-mes";

  if (preset === "mes") {
    const year = Number(params.ano) || currentYear;
    const month = Number(params.mes) || currentMonth;
    const range = monthRange(year, month);
    const previousMonth = addMonths(year, month, -1);
    const previousRange = monthRange(previousMonth.year, previousMonth.month);

    return {
      preset,
      ...range,
      label: formatMonthYear(year, month),
      previous: {
        ...previousRange,
        label: formatMonthYear(previousMonth.year, previousMonth.month),
      },
    };
  }

  if (preset === "personalizado") {
    const from = ISO_DATE.test(params.de ?? "") ? params.de! : firstDayOfMonth(currentYear, currentMonth);
    const to = ISO_DATE.test(params.ate ?? "") ? params.ate! : lastDayOfMonth(currentYear, currentMonth);
    const normalized = from <= to ? { from, to } : { from: to, to: from };
    const length = daysBetween(normalized.from, normalized.to) + 1;

    return {
      preset,
      ...normalized,
      label: "Período personalizado",
      previous: {
        from: shiftDays(normalized.from, -length),
        to: shiftDays(normalized.from, -1),
        label: "Período anterior equivalente",
      },
    };
  }

  if (preset === "mes-anterior") {
    const previousMonth = addMonths(currentYear, currentMonth, -1);
    const beforeThat = addMonths(currentYear, currentMonth, -2);

    return {
      preset,
      ...monthRange(previousMonth.year, previousMonth.month),
      label: formatMonthYear(previousMonth.year, previousMonth.month),
      previous: {
        ...monthRange(beforeThat.year, beforeThat.month),
        label: formatMonthYear(beforeThat.year, beforeThat.month),
      },
    };
  }

  if (preset === "ultimos-3-meses" || preset === "ultimos-6-meses") {
    const months = preset === "ultimos-3-meses" ? 3 : 6;
    const start = addMonths(currentYear, currentMonth, -(months - 1));
    const previousStart = addMonths(currentYear, currentMonth, -(months * 2 - 1));
    const previousEnd = addMonths(currentYear, currentMonth, -months);

    return {
      preset,
      from: firstDayOfMonth(start.year, start.month),
      to: lastDayOfMonth(currentYear, currentMonth),
      label: `Últimos ${months} meses`,
      previous: {
        from: firstDayOfMonth(previousStart.year, previousStart.month),
        to: lastDayOfMonth(previousEnd.year, previousEnd.month),
        label: `${months} meses anteriores`,
      },
    };
  }

  if (preset === "ano-atual" || preset === "ano-anterior") {
    const year = preset === "ano-atual" ? currentYear : currentYear - 1;

    return {
      preset,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `Ano de ${year}`,
      previous: {
        from: `${year - 1}-01-01`,
        to: `${year - 1}-12-31`,
        label: `Ano de ${year - 1}`,
      },
    };
  }

  // Este mês (padrão)
  const previousMonth = addMonths(currentYear, currentMonth, -1);
  return {
    preset: "este-mes",
    ...monthRange(currentYear, currentMonth),
    label: formatMonthYear(currentYear, currentMonth),
    previous: {
      ...monthRange(previousMonth.year, previousMonth.month),
      label: formatMonthYear(previousMonth.year, previousMonth.month),
    },
  };
}

/** Últimos 12 meses encerrando no mês do período selecionado. */
export function trailingTwelveMonths(reference: string): { from: string; to: string } {
  const date = parseISODate(reference);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const start = addMonths(year, month, -11);

  return {
    from: firstDayOfMonth(start.year, start.month),
    to: lastDayOfMonth(year, month),
  };
}
