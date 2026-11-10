import { describe, expect, it } from "vitest";
import { buildDre, monthsBetween, type DreSourceRow } from "@/lib/finance/dre";

const rows: DreSourceRow[] = [
  { nature: "own_revenue", group_id: "g1", group_name: "Receitas", category_id: "c1", category_name: "Taxa de administração", period_key: "2026-01", amount: 1000 },
  { nature: "own_revenue", group_id: "g1", group_name: "Receitas", category_id: "c2", category_name: "Comissão", period_key: "2026-02", amount: 18000 },
  { nature: "deduction", group_id: "g2", group_name: "Impostos", category_id: "c3", category_name: "Simples", period_key: "2026-02", amount: -1080 },
  { nature: "operating_expense", group_id: "g3", group_name: "Administrativas", category_id: "c4", category_name: "Aluguel", period_key: "2026-01", amount: -3000 },
  { nature: "operating_expense", group_id: "g3", group_name: "Administrativas", category_id: "c4", category_name: "Aluguel", period_key: "2026-02", amount: -3000 },
  { nature: "third_party", group_id: "g4", group_name: "Terceiros", category_id: "c5", category_name: "Repasse", period_key: "2026-01", amount: 9000 },
  { nature: "third_party", group_id: "g4", group_name: "Terceiros", category_id: "c5", category_name: "Repasse", period_key: "2026-01", amount: -9000 },
];

describe("buildDre", () => {
  const dre = buildDre(rows, ["2026-01", "2026-02"]);

  it("soma subtotais na ordem da DRE", () => {
    const subtotals = Object.fromEntries(
      dre.rows.filter((row) => row.type === "subtotal").map((row) => [row.subtotal.key, row.subtotal.total]),
    );
    expect(subtotals).toEqual({ net_revenue: 17920, gross_profit: 17920, operating_result: 11920, net_result: 11920 });
    expect(dre.netResult.byPeriod).toEqual({ "2026-01": -2000, "2026-02": 13920 });
  });

  it("deixa dinheiro de terceiros fora do resultado, em memória à parte", () => {
    expect(dre.memo.map((section) => section.key)).toEqual(["third_party"]);
    expect(dre.memo[0].total).toBe(0);
  });

  it("calcula a margem líquida sem dividir por zero", () => {
    expect(dre.netMargin.total).toBeCloseTo((11920 / 19000) * 100, 2);
    expect(buildDre([], ["2026-01"]).netMargin.total).toBeNull();
  });

  it("agrupa categorias dentro do grupo", () => {
    const expenses = dre.rows.find((row) => row.type === "section" && row.section.key === "operating_expenses");
    expect(expenses?.type === "section" && expenses.section.groups[0].categories[0].total).toBe(-6000);
  });
});

describe("monthsBetween", () => {
  it("atravessa a virada do ano", () => {
    expect(monthsBetween("2025-11-01", "2026-02-28")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});
