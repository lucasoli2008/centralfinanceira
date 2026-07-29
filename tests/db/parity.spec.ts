/**
 * Paridade obrigatória: o motor financeiro em TypeScript e o motor financeiro
 * em SQL precisam produzir exatamente os mesmos centavos — inclusive nas
 * frações de centavo. Também confere que dashboard/tabela/relatório (que usam
 * report_summary) batem com a soma calculada em TypeScript.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculateEntryTotals, roundMoney } from "@/lib/finance/engine";
import type { AmountMode } from "@/lib/finance/types";
import {
  asUser,
  createTestDatabase,
  seedOrganization,
  type SeededOrganization,
  type TestDatabase,
} from "./helpers/database";

let db: TestDatabase;
let org: SeededOrganization;

interface Scenario {
  label: string;
  entryType: "sale" | "rental";
  date: string;
  baseAmount: number;
  commissionMode: AmountMode;
  commissionRate?: number;
  commissionFixedAmount?: number;
  splits: { brokerIndex: number; mode: AmountMode; rate?: number; fixedAmount?: number }[];
}

const scenarios: Scenario[] = [
  {
    label: "venda 6% com um corretor de 40%",
    entryType: "sale",
    date: "2026-01-05",
    baseAmount: 500000,
    commissionMode: "percentage",
    commissionRate: 6,
    splits: [{ brokerIndex: 0, mode: "percentage", rate: 40 }],
  },
  {
    label: "venda 5,5% com dois corretores",
    entryType: "sale",
    date: "2026-01-19",
    baseAmount: 437777.77,
    commissionMode: "percentage",
    commissionRate: 5.5,
    splits: [
      { brokerIndex: 0, mode: "percentage", rate: 37.5 },
      { brokerIndex: 1, mode: "percentage", rate: 12.25 },
    ],
  },
  {
    label: "venda com comissão fixa e repasse fixo",
    entryType: "sale",
    date: "2026-02-07",
    baseAmount: 512345.67,
    commissionMode: "fixed",
    commissionFixedAmount: 25000.55,
    splits: [{ brokerIndex: 2, mode: "fixed", fixedAmount: 7000.33 }],
  },
  {
    label: "locação 100% com repasse de 50%",
    entryType: "rental",
    date: "2026-02-14",
    baseAmount: 3333.33,
    commissionMode: "percentage",
    commissionRate: 100,
    splits: [{ brokerIndex: 1, mode: "percentage", rate: 50 }],
  },
  {
    label: "fração de centavo em três repasses",
    entryType: "sale",
    date: "2026-03-03",
    baseAmount: 100000,
    commissionMode: "percentage",
    commissionRate: 6.13,
    splits: [
      { brokerIndex: 0, mode: "percentage", rate: 33.33 },
      { brokerIndex: 1, mode: "percentage", rate: 33.33 },
      { brokerIndex: 2, mode: "percentage", rate: 33.34 },
    ],
  },
  {
    label: "mistura de percentual e valor fixo",
    entryType: "sale",
    date: "2026-03-21",
    baseAmount: 749999.99,
    commissionMode: "percentage",
    commissionRate: 4.75,
    splits: [
      { brokerIndex: 0, mode: "percentage", rate: 30.5 },
      { brokerIndex: 1, mode: "fixed", fixedAmount: 5123.45 },
    ],
  },
  {
    label: "locação comercial sem corretor",
    entryType: "rental",
    date: "2026-04-02",
    baseAmount: 5200.5,
    commissionMode: "percentage",
    commissionRate: 100,
    splits: [],
  },
];

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrganization(db, "Paridade Imóveis");

  for (const scenario of scenarios) {
    const payload = {
      entry_type: scenario.entryType,
      entry_date: scenario.date,
      description: scenario.label,
      property_type: "residential",
      base_amount: scenario.baseAmount,
      commission_mode: scenario.commissionMode,
      commission_rate: scenario.commissionRate ?? null,
      commission_fixed_amount: scenario.commissionFixedAmount ?? null,
      splits: scenario.splits.map((split) => ({
        broker_id: org.brokerIds[split.brokerIndex],
        split_mode: split.mode,
        split_rate: split.rate ?? null,
        split_fixed_amount: split.fixedAmount ?? null,
      })),
    };

    await asUser(db, org.ownerId, () =>
      db.query(`select public.app_save_entry($1::jsonb)`, [JSON.stringify(payload)]),
    );
  }
});

afterAll(async () => {
  await db?.close();
});

function expectedTotals(scenario: Scenario) {
  return calculateEntryTotals(
    {
      mode: scenario.commissionMode,
      baseAmount: scenario.baseAmount,
      rate: scenario.commissionRate,
      fixedAmount: scenario.commissionFixedAmount,
    },
    scenario.splits.map((split) => ({
      mode: split.mode,
      rate: split.rate,
      fixedAmount: split.fixedAmount,
    })),
  );
}

describe("paridade TypeScript × PostgreSQL", () => {
  it.each(scenarios.map((scenario) => [scenario.label, scenario] as const))(
    "%s",
    async (_label, scenario) => {
      const expected = expectedTotals(scenario);

      const result = await asUser(db, org.ownerId, () =>
        db.query<{
          gross_commission: string;
          total_broker_payout: string;
          net_company_revenue: string;
          net_margin: string | null;
        }>(
          `select gross_commission, total_broker_payout, net_company_revenue, net_margin
           from public.financial_entry_totals where description = $1`,
          [scenario.label],
        ),
      );

      const row = result.rows[0];
      expect(Number(row.gross_commission)).toBe(expected.grossCommission);
      expect(Number(row.total_broker_payout)).toBe(expected.totalBrokerPayout);
      expect(Number(row.net_company_revenue)).toBe(expected.netCompanyRevenue);
      expect(row.net_margin === null ? null : Number(row.net_margin)).toBe(expected.netMargin);
    },
  );

  it("report_summary bate com a soma calculada em TypeScript", async () => {
    const expected = scenarios.reduce(
      (accumulator, scenario) => {
        const totals = expectedTotals(scenario);
        return {
          gross: roundMoney(accumulator.gross + totals.grossCommission),
          payout: roundMoney(accumulator.payout + totals.totalBrokerPayout),
          net: roundMoney(accumulator.net + totals.netCompanyRevenue),
          count: accumulator.count + 1,
        };
      },
      { gross: 0, payout: 0, net: 0, count: 0 },
    );

    const summary = await asUser(db, org.ownerId, () =>
      db.query<{
        total_gross_commission: string;
        total_broker_payout: string;
        total_net_revenue: string;
        entries_count: number;
      }>(`select * from public.report_summary('2026-01-01', '2026-12-31')`),
    );

    const row = summary.rows[0];
    expect(Number(row.total_gross_commission)).toBe(expected.gross);
    expect(Number(row.total_broker_payout)).toBe(expected.payout);
    expect(Number(row.total_net_revenue)).toBe(expected.net);
    expect(row.entries_count).toBe(expected.count);
  });

  it("resumo mensal e série mensal batem com o resumo do período", async () => {
    const summary = await asUser(db, org.ownerId, () =>
      db.query<{ total_gross_commission: string; total_net_revenue: string }>(
        `select * from public.report_summary('2026-01-01', '2026-12-31')`,
      ),
    );

    const series = await asUser(db, org.ownerId, () =>
      db.query<{ total_gross_commission: string; total_net_revenue: string; period_key: string }>(
        `select * from public.report_monthly_series('2026-01-01', '2026-12-31')`,
      ),
    );

    const monthly = await asUser(db, org.ownerId, () =>
      db.query<{ total_gross_commission: string }>(
        `select * from public.monthly_financial_summary where organization_id = $1`,
        [org.organizationId],
      ),
    );

    expect(series.rows).toHaveLength(12);

    const seriesGross = roundMoney(
      series.rows.reduce((total, row) => total + Number(row.total_gross_commission), 0),
    );
    const monthlyGross = roundMoney(
      monthly.rows.reduce((total, row) => total + Number(row.total_gross_commission), 0),
    );

    expect(seriesGross).toBe(Number(summary.rows[0].total_gross_commission));
    expect(monthlyGross).toBe(Number(summary.rows[0].total_gross_commission));
  });

  it("ranking de corretores soma exatamente o total de repasses", async () => {
    const summary = await asUser(db, org.ownerId, () =>
      db.query<{ total_broker_payout: string }>(
        `select * from public.report_summary('2026-01-01', '2026-12-31')`,
      ),
    );

    const ranking = await asUser(db, org.ownerId, () =>
      db.query<{ total_payout: string; participations: number }>(
        `select * from public.report_broker_ranking('2026-01-01', '2026-12-31')`,
      ),
    );

    const rankingTotal = roundMoney(
      ranking.rows.reduce((total, row) => total + Number(row.total_payout), 0),
    );

    expect(rankingTotal).toBe(Number(summary.rows[0].total_broker_payout));
  });
});
