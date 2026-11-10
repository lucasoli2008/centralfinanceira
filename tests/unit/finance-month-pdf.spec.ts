import { describe, expect, it } from "vitest";
import { buildDre } from "@/lib/finance/dre";
import { renderMonthReport, renderYearReport } from "@/server/reports/finance-month-pdf";
import type { FinSummaryRow, FinYearCardRow } from "@/types/database";

const branding = { organizationName: "Roberta Oliveira Imóveis", logoUrl: null, accentColor: "#9f1239", header: null, footer: null, generatedBy: "Teste" };
const summary = new Proxy({}, { get: () => 100 }) as unknown as FinSummaryRow;
const dre = buildDre(
  [{ nature: "own_revenue", group_id: "g", group_name: "Receitas", category_id: "c", category_name: "Taxa", period_key: "2026-11", amount: 1000 }],
  ["2026-11"],
);

describe("PDFs do mês e do ano", () => {
  it("gera o relatório do mês", async () => {
    const buffer = await renderMonthReport({
      branding,
      year: 2026,
      month: 11,
      cash: summary,
      competence: summary,
      dre,
      expensesByCategory: [{ category_id: "x", category_name: "Energia elétrica", group_name: "Despesas", nature: "operating_expense", total: 480, items_count: 1 }],
      incomeByCategory: [],
      bills: [{ entry_id: "e", recurrence_id: "r", description: "Salário", kind: "expense", amount: 2000, remaining: 0, due_date: "2026-11-05", status: "settled", value_mode: "fixed", category_name: "Salários", account_id: null }],
      entries: [],
      closed: false,
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("gera o relatório do ano", async () => {
    const cards: FinYearCardRow[] = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1, cash_in: index * 100, cash_out: 50, revenue: 0, expenses: 0, result: index * 50 - 100, closing_balance: 0,
      payables_count: 0, payables_amount: 0, receivables_count: 0, receivables_amount: 0, statement_pending: 0, is_closed: index < 3,
    }));
    const buffer = await renderYearReport({ branding, year: 2026, cards, dre, expensesByCategory: [] });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
