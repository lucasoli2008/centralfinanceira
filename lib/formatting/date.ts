/**
 * Datas no padrão brasileiro, sempre no fuso America/Sao_Paulo.
 *
 * Datas de lançamento são armazenadas como `date` (sem hora) no banco; para
 * evitar deslocamento de fuso, o texto "YYYY-MM-DD" é convertido manualmente,
 * nunca via new Date("2026-07-28") interpretado como UTC.
 */

export const TIMEZONE = "America/Sao_Paulo";
const LOCALE = "pt-BR";

export const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export const MONTH_SHORT_NAMES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

/** Converte "YYYY-MM-DD" em Date local, sem interpretar como UTC. */
export function parseISODate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 28/07/2026 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseISODate(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** 28/07/2026 às 14:35 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const formatted = new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(date);
  return formatted.replace(", ", " às ");
}

/** Julho de 2026 */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ""} de ${year}`;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

export function monthShortName(month: number): string {
  return MONTH_SHORT_NAMES[month - 1] ?? "";
}

/** "2026-07" -> { year: 2026, month: 7 } */
export function parsePeriodKey(periodKey: string): { year: number; month: number } {
  const [year, month] = periodKey.split("-").map(Number);
  return { year, month };
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Hoje no fuso da imobiliária, como "YYYY-MM-DD". */
export function todayInTimezone(timeZone: string = TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}
