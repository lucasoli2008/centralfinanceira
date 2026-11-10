import { describe, expect, it } from "vitest";
import { buildDre, type DreSourceRow } from "@/lib/finance/dre";
import { renderClosingReport, renderDreReport } from "@/server/reports/finance-pdf";
import type { FinSummaryRow } from "@/types/database";

const branding = {
  organizationName: "Roberta Oliveira Imóveis",
  logoUrl: null,
  accentColor: "#b91c1c",
  header: null,
  footer: null,
  generatedBy: "Teste",
};

const rows: DreSourceRow[] = [
  { nature: "own_revenue", group_id: "g1", group_name: "Receitas", category_id: "c1", category_name: "Taxa", period_key: "2026-01", amount: 1000 },
  { nature: "third_party", group_id: "g2", group_name: "Terceiros", category_id: "c2", category_name: "Repasse", period_key: "2026-01", amount: -900 },
];

const summary = Object.fromEntries(
  ["cash_balance", "cash_in", "cash_out", "own_revenue", "other_revenue", "net_result", "third_party_obligations", "own_available", "partner_withdrawals"].map(
    (key) => [key, 100],
  ),
) as unknown as FinSummaryRow;

describe("PDFs do financeiro", () => {
  it("gera a DRE em PDF", async () => {
    const buffer = await renderDreReport({ branding, title: "DRE gerencial", subtitle: "Ano", dre: buildDre(rows, ["2026-01", "2026-02"]) });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("gera o pacote de fechamento em PDF", async () => {
    const buffer = await renderClosingReport({
      branding,
      label: "janeiro de 2026",
      status: "Fechado",
      notes: null,
      summary,
      dre: buildDre(rows, ["2026-01"]),
      checklist: [{ check_key: "statement_pending", label: "Extrato", severity: "warning", quantity: 0, amount: 0, href: "/" }],
      balances: [{ account_id: "a", name: "Itaú", kind: "checking", is_active: true, balance: 100 }],
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
