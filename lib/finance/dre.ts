/**
 * Monta a DRE gerencial a partir das linhas de fin_report_dre (0012).
 *
 * Não há cálculo contábil aqui além de SOMAR valores já classificados pelo
 * banco: cada linha chega com a natureza da categoria e o valor com sinal de
 * efeito no caixa (+ entrada, − saída). Subtotais são somas dessas linhas,
 * então o "Resultado líquido" é idêntico ao net_result de fin_report_summary
 * (verificado em tests/db/reports-close.spec.ts e tests/unit/dre.spec.ts).
 */

import type { FinNature } from "@/types/database";

export interface DreSourceRow {
  nature: FinNature;
  group_id: string | null;
  group_name: string | null;
  category_id: string;
  category_name: string;
  period_key: string;
  amount: number;
}

export interface DreValues {
  byPeriod: Record<string, number>;
  total: number;
}

export interface DreCategoryLine extends DreValues {
  id: string;
  name: string;
}

export interface DreGroupLine extends DreValues {
  id: string;
  name: string;
  categories: DreCategoryLine[];
}

export interface DreSection extends DreValues {
  key: string;
  label: string;
  natures: FinNature[];
  groups: DreGroupLine[];
}

export interface DreSubtotal extends DreValues {
  key: string;
  label: string;
  emphasis?: boolean;
}

export type DreRow = { type: "section"; section: DreSection } | { type: "subtotal"; subtotal: DreSubtotal };

export interface DreStatement {
  periods: string[];
  rows: DreRow[];
  memo: DreSection[];
  netResult: DreValues;
  grossRevenue: DreValues;
  /** Resultado líquido ÷ receita operacional bruta, por período (null sem receita). */
  netMargin: Record<string, number | null> & { total: number | null };
}

const SECTIONS: { key: string; label: string; natures: FinNature[] }[] = [
  { key: "gross_revenue", label: "Receita operacional bruta", natures: ["own_revenue"] },
  { key: "deductions", label: "(−) Deduções e impostos sobre a receita", natures: ["deduction"] },
  { key: "direct_costs", label: "(−) Custos diretos", natures: ["direct_cost"] },
  { key: "operating_expenses", label: "(−) Despesas operacionais", natures: ["operating_expense"] },
  { key: "other_revenue", label: "(+) Outras receitas", natures: ["other_revenue"] },
  { key: "other_expenses", label: "(−) Outras despesas", natures: ["other_expense"] },
];

const MEMO: { key: string; label: string; natures: FinNature[] }[] = [
  { key: "third_party", label: "Valores de terceiros (repasses — não são receita)", natures: ["third_party"] },
  { key: "deposit", label: "Cauções recebidas e devolvidas", natures: ["deposit"] },
  { key: "equity", label: "Movimentos de sócios (aportes e retiradas)", natures: ["equity"] },
];

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function emptyValues(periods: string[]): DreValues {
  return { byPeriod: Object.fromEntries(periods.map((period) => [period, 0])), total: 0 };
}

function addInto(target: DreValues, period: string, amount: number) {
  if (period in target.byPeriod) target.byPeriod[period] = round2(target.byPeriod[period] + amount);
  target.total = round2(target.total + amount);
}

function sumValues(periods: string[], parts: DreValues[]): DreValues {
  const result = emptyValues(periods);
  for (const part of parts) {
    for (const period of periods) result.byPeriod[period] = round2(result.byPeriod[period] + (part.byPeriod[period] ?? 0));
    result.total = round2(result.total + part.total);
  }
  return result;
}

function buildSection(
  definition: { key: string; label: string; natures: FinNature[] },
  rows: DreSourceRow[],
  periods: string[],
): DreSection {
  const section: DreSection = { ...definition, ...emptyValues(periods), groups: [] };
  const groups = new Map<string, DreGroupLine>();
  for (const row of rows) {
    if (!definition.natures.includes(row.nature)) continue;
    const groupId = row.group_id ?? row.category_id;
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, name: row.group_name ?? row.category_name, categories: [], ...emptyValues(periods) };
      groups.set(groupId, group);
      section.groups.push(group);
    }
    let category = group.categories.find((item) => item.id === row.category_id);
    if (!category) {
      category = { id: row.category_id, name: row.category_name, ...emptyValues(periods) };
      group.categories.push(category);
    }
    addInto(category, row.period_key, row.amount);
    addInto(group, row.period_key, row.amount);
    addInto(section, row.period_key, row.amount);
  }
  return section;
}

/** Lista de meses "AAAA-MM" entre duas datas ISO (inclusive). */
export function monthsBetween(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
    if (months.length > 120) break;
  }
  return months;
}

export function buildDre(rows: DreSourceRow[], periods: string[]): DreStatement {
  const sections = Object.fromEntries(SECTIONS.map((definition) => [definition.key, buildSection(definition, rows, periods)]));
  const subtotal = (key: string, label: string, parts: DreValues[], emphasis = false): DreSubtotal => ({
    key,
    label,
    emphasis,
    ...sumValues(periods, parts),
  });

  const netRevenue = subtotal("net_revenue", "= Receita operacional líquida", [sections.gross_revenue, sections.deductions]);
  const grossProfit = subtotal("gross_profit", "= Resultado bruto", [netRevenue, sections.direct_costs]);
  const operating = subtotal("operating_result", "= Resultado operacional", [grossProfit, sections.operating_expenses]);
  const net = subtotal("net_result", "= Resultado líquido", [operating, sections.other_revenue, sections.other_expenses], true);

  const rowsOut: DreRow[] = [
    { type: "section", section: sections.gross_revenue },
    { type: "section", section: sections.deductions },
    { type: "subtotal", subtotal: netRevenue },
    { type: "section", section: sections.direct_costs },
    { type: "subtotal", subtotal: grossProfit },
    { type: "section", section: sections.operating_expenses },
    { type: "subtotal", subtotal: operating },
    { type: "section", section: sections.other_revenue },
    { type: "section", section: sections.other_expenses },
    { type: "subtotal", subtotal: net },
  ];

  const margin = (result: number, revenue: number) => (revenue > 0 ? round2((result / revenue) * 100) : null);
  const netMargin = Object.assign(
    Object.fromEntries(periods.map((period) => [period, margin(net.byPeriod[period], sections.gross_revenue.byPeriod[period])])),
    { total: margin(net.total, sections.gross_revenue.total) },
  ) as DreStatement["netMargin"];

  return {
    periods,
    rows: rowsOut,
    memo: MEMO.map((definition) => buildSection(definition, rows, periods)).filter((section) => section.groups.length > 0),
    netResult: net,
    grossRevenue: sections.gross_revenue,
    netMargin,
  };
}
