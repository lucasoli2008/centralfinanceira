/**
 * Testes financeiros obrigatórios (docs/FINANCIAL_RULES.md e prompt §36).
 */

import { describe, expect, it } from "vitest";
import {
  calculateEntryTotals,
  calculateGrossCommission,
  calculateNetMargin,
  calculateSplitAmount,
  calculateVariation,
  roundMoney,
  safeRatio,
} from "@/lib/finance/engine";

describe("comissão bruta", () => {
  it("venda simples com comissão percentual", () => {
    expect(
      calculateGrossCommission({ mode: "percentage", baseAmount: 500000, rate: 6 }),
    ).toBe(30000);
  });

  it("comissão decimal de 5,5%", () => {
    expect(
      calculateGrossCommission({ mode: "percentage", baseAmount: 400000, rate: 5.5 }),
    ).toBe(22000);
  });

  it("comissão fixa substitui o cálculo percentual", () => {
    expect(
      calculateGrossCommission({
        mode: "fixed",
        baseAmount: 500000,
        rate: 6,
        fixedAmount: 25000,
      }),
    ).toBe(25000);
  });

  it("locação com 100% do primeiro aluguel", () => {
    expect(calculateGrossCommission({ mode: "percentage", baseAmount: 3000, rate: 100 })).toBe(
      3000,
    );
  });
});

describe("repasses", () => {
  it("repasse percentual", () => {
    expect(calculateSplitAmount(30000, { mode: "percentage", rate: 40 })).toBe(12000);
  });

  it("repasse decimal de 37,5%", () => {
    expect(calculateSplitAmount(22000, { mode: "percentage", rate: 37.5 })).toBe(8250);
  });

  it("repasse fixo", () => {
    expect(calculateSplitAmount(30000, { mode: "fixed", fixedAmount: 10000 })).toBe(10000);
  });
});

describe("lançamentos completos", () => {
  it("venda simples com um corretor de 40%", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 500000, rate: 6 }, [
      { brokerId: "a", mode: "percentage", rate: 40 },
    ]);

    expect(totals.grossCommission).toBe(30000);
    expect(totals.totalBrokerPayout).toBe(12000);
    expect(totals.netCompanyRevenue).toBe(18000);
    expect(totals.netMargin).toBe(60);
    expect(totals.brokerCount).toBe(1);
    expect(totals.isNegativeNet).toBe(false);
  });

  it("venda com dois corretores (40% e 15%)", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 500000, rate: 6 }, [
      { brokerId: "a", mode: "percentage", rate: 40 },
      { brokerId: "b", mode: "percentage", rate: 15 },
    ]);

    expect(totals.grossCommission).toBe(30000);
    expect(totals.splits.map((split) => split.payoutAmount)).toEqual([12000, 4500]);
    expect(totals.totalBrokerPayout).toBe(16500);
    expect(totals.netCompanyRevenue).toBe(13500);
    expect(totals.netMargin).toBe(45);
  });

  it("locação com repasse de 50%", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 3000, rate: 100 }, [
      { brokerId: "a", mode: "percentage", rate: 50 },
    ]);

    expect(totals.grossCommission).toBe(3000);
    expect(totals.totalBrokerPayout).toBe(1500);
    expect(totals.netCompanyRevenue).toBe(1500);
  });

  it("comissão fixa com repasse fixo", () => {
    const totals = calculateEntryTotals(
      { mode: "fixed", baseAmount: 500000, fixedAmount: 25000 },
      [{ brokerId: "a", mode: "fixed", fixedAmount: 7000 }],
    );

    expect(totals.grossCommission).toBe(25000);
    expect(totals.totalBrokerPayout).toBe(7000);
    expect(totals.netCompanyRevenue).toBe(18000);
  });

  it("mistura percentual e valor fixo entre corretores", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 750000, rate: 5 }, [
      { brokerId: "a", mode: "percentage", rate: 30 },
      { brokerId: "b", mode: "fixed", fixedAmount: 5000 },
      { brokerId: "c", mode: "percentage", rate: 12.5 },
    ]);

    expect(totals.grossCommission).toBe(37500);
    expect(totals.splits.map((split) => split.payoutAmount)).toEqual([11250, 5000, 4687.5]);
    expect(totals.totalBrokerPayout).toBe(20937.5);
    expect(totals.netCompanyRevenue).toBe(16562.5);
  });

  it("lançamento sem corretores mantém toda a comissão", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 200000, rate: 6 });

    expect(totals.totalBrokerPayout).toBe(0);
    expect(totals.netCompanyRevenue).toBe(12000);
    expect(totals.netMargin).toBe(100);
    expect(totals.brokerCount).toBe(0);
  });
});

describe("arredondamento", () => {
  it("arredonda a comissão bruta para duas casas (meio para cima)", () => {
    // 333.333,33 × 5,55% = 18.499,99981...
    expect(
      calculateGrossCommission({ mode: "percentage", baseAmount: 333333.33, rate: 5.55 }),
    ).toBe(18500);
  });

  it("arredonda cada repasse individualmente antes de somar", () => {
    const totals = calculateEntryTotals(
      { mode: "percentage", baseAmount: 100000, rate: 6.13 },
      [
        { brokerId: "a", mode: "percentage", rate: 33.33 },
        { brokerId: "b", mode: "percentage", rate: 33.33 },
        { brokerId: "c", mode: "percentage", rate: 33.34 },
      ],
    );

    // bruta = 6.130,00; repasses = 2.043,13 + 2.043,13 + 2.043,74
    expect(totals.grossCommission).toBe(6130);
    expect(totals.splits.map((split) => split.payoutAmount)).toEqual([2043.13, 2043.13, 2043.74]);
    expect(totals.totalBrokerPayout).toBe(6130);
    expect(totals.netCompanyRevenue).toBe(0);
    expect(totals.netMargin).toBe(0);
  });

  it("resolve frações de centavo com arredondamento comercial", () => {
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(calculateSplitAmount(1000.05, { mode: "percentage", rate: 33.5 })).toBe(335.02);
  });
});

describe("margem e divisões seguras", () => {
  it("não divide por zero quando a comissão bruta é zero", () => {
    const totals = calculateEntryTotals({ mode: "fixed", baseAmount: 0, fixedAmount: 0 });
    expect(totals.netMargin).toBeNull();
    expect(calculateNetMargin(0, 0)).toBeNull();
  });

  it("mantém margem negativa visível", () => {
    const totals = calculateEntryTotals({ mode: "percentage", baseAmount: 100000, rate: 5 }, [
      { brokerId: "a", mode: "fixed", fixedAmount: 6000 },
    ]);

    expect(totals.grossCommission).toBe(5000);
    expect(totals.netCompanyRevenue).toBe(-1000);
    expect(totals.netMargin).toBe(-20);
    expect(totals.isNegativeNet).toBe(true);
  });

  it("variação retorna null quando não há período anterior", () => {
    expect(calculateVariation(1000, 0)).toBeNull();
    expect(calculateVariation(1500, 1000)).toBe(50);
    expect(calculateVariation(500, 1000)).toBe(-50);
  });

  it("safeRatio protege ticket médio sem lançamentos", () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(30000, 4)).toBe(7500);
    expect(safeRatio(16500, 30000, { asPercentage: true })).toBe(55);
  });
});

describe("independência do histórico", () => {
  it("alterar o padrão não altera o cálculo de um lançamento existente", () => {
    const existingEntry = { mode: "percentage" as const, baseAmount: 500000, rate: 6 };
    const grossBefore = calculateGrossCommission(existingEntry);

    // Novo padrão da imobiliária: 5%. O lançamento antigo guarda a própria taxa.
    const newDefaultRate = 5;
    const newEntry = { mode: "percentage" as const, baseAmount: 500000, rate: newDefaultRate };

    expect(grossBefore).toBe(30000);
    expect(calculateGrossCommission(existingEntry)).toBe(30000);
    expect(calculateGrossCommission(newEntry)).toBe(25000);
  });
});
