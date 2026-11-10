/**
 * Controle Financeiro — Fase 3: DRE gerencial, fluxo de caixa projetado,
 * fechamento mensal e central de inteligência (PGlite).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createTestDatabase,
  expectError,
  seedOrganization,
  type SeededOrganization,
  type TestDatabase,
} from "./helpers/database";

let db: TestDatabase;
let org: SeededOrganization;
let checking: string;
let feeCategory: string;
let expenseCategory: string;

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function shift(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Um mês inteiro já terminado: dois meses atrás. */
const PAST = (() => {
  const [year, month] = TODAY.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 3, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
})();
const PAST_DAY = `${PAST.year}-${String(PAST.month).padStart(2, "0")}-10`;

async function rpc<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(db, userId, async () => (await db.query<T>(sql, params)).rows);
}

async function one<T>(userId: string, sql: string, params: unknown[] = []): Promise<T> {
  return (await rpc<T>(userId, sql, params))[0];
}

async function categoryByNature(nature: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.fin_categories where organization_id = $1 and nature = $2 and parent_id is not null order by name limit 1`,
    [org.organizationId, nature],
  );
  return result.rows[0].id;
}

async function saveEntry(payload: Record<string, unknown>, userId = org.ownerId): Promise<string> {
  const row = await one<{ ids: string[] }>(userId, `select public.app_fin_save_entry($1::jsonb) as ids`, [JSON.stringify(payload)]);
  return row.ids[0];
}

async function setRole(role: string) {
  await rpc(org.ownerId, `select public.app_set_member_finance_role(id, $2) from public.organization_members where user_id = $1`, [
    org.adminId,
    role,
  ]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrganization(db, "Roberta Oliveira Imóveis");
  checking = (
    await one<{ id: string }>(org.ownerId, `select public.app_fin_save_account($1::jsonb) as id`, [
      JSON.stringify({ name: "Itaú", opening_balance: 2000, opening_date: `${PAST.year - 1}-01-01` }),
    ])
  ).id;
  feeCategory = await categoryByNature("own_revenue");
  expenseCategory = await categoryByNature("operating_expense");

  // Mês passado: receita 3.000 recebida, despesa 800 paga.
  await saveEntry({ kind: "income", description: "Taxa adm", amount: 3000, category_id: feeCategory, competence_date: PAST_DAY, settle_now: true, account_id: checking });
  await saveEntry({ kind: "expense", description: "Aluguel sala", amount: 800, category_id: expenseCategory, competence_date: PAST_DAY, settle_now: true, account_id: checking });
  // Futuro: a receber 1.000 em 10 dias, a pagar 500 em 5 dias, despesa vencida de 300.
  await saveEntry({ kind: "income", description: "Taxa a receber", amount: 1000, category_id: feeCategory, competence_date: TODAY, due_date: shift(TODAY, 10) });
  await saveEntry({ kind: "expense", description: "Internet", amount: 500, category_id: expenseCategory, competence_date: TODAY, due_date: shift(TODAY, 5) });
  await saveEntry({ kind: "expense", description: "Energia atrasada", amount: 300, category_id: expenseCategory, competence_date: shift(TODAY, -20), due_date: shift(TODAY, -15) });
});

afterAll(async () => {
  await db?.close();
});

describe("DRE gerencial", () => {
  it("soma das linhas de resultado = resultado do resumo, nos dois regimes", async () => {
    for (const regime of ["competencia", "caixa"]) {
      const rows = await rpc<{ nature: string; amount: string }>(
        org.ownerId,
        `select nature, amount from public.fin_report_dre('2000-01-01', '2100-12-31', $1)`,
        [regime],
      );
      const resultNatures = ["own_revenue", "other_revenue", "deduction", "direct_cost", "operating_expense", "other_expense"];
      const dreTotal = rows.filter((row) => resultNatures.includes(row.nature)).reduce((sum, row) => sum + Number(row.amount), 0);
      const summary = await one<{ net_result: string }>(
        org.ownerId,
        `select net_result from public.fin_report_summary('2000-01-01', '2100-12-31', $1)`,
        [regime],
      );
      expect(Math.round(dreTotal * 100) / 100, regime).toBe(Number(summary.net_result));
    }
  });

  it("separa por mês", async () => {
    const rows = await rpc<{ period_key: string; amount: string }>(
      org.ownerId,
      `select period_key, amount from public.fin_report_dre($1, $2, 'competencia') where nature = 'own_revenue'`,
      [`${PAST.year}-${String(PAST.month).padStart(2, "0")}-01`, PAST_DAY],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(3000);
  });
});

describe("fluxo de caixa projetado", () => {
  it("começa pelos vencidos e termina igual à previsão de 30 dias do painel", async () => {
    const rows = await rpc<{ bucket_start: string | null; outflow: string; closing_balance: string; opening_balance: string }>(
      org.ownerId,
      `select * from public.fin_cash_projection(30, 'day')`,
    );
    expect(rows[0].bucket_start).toBeNull();
    expect(Number(rows[0].outflow)).toBe(300);
    expect(Number(rows[0].opening_balance)).toBe(4200); // 2000 + 3000 − 800

    const summary = await one<{ forecast_30_balance: string }>(
      org.ownerId,
      `select forecast_30_balance from public.fin_report_summary($1, $1)`,
      [TODAY],
    );
    expect(Number(rows[rows.length - 1].closing_balance)).toBe(Number(summary.forecast_30_balance));
    expect(Number(rows[rows.length - 1].closing_balance)).toBe(4200 - 300 - 500 + 1000);
  });

  it("agrupa por semana", async () => {
    const rows = await rpc<{ bucket_start: string | null; inflow: string; outflow: string }>(
      org.ownerId,
      `select * from public.fin_cash_projection(30, 'week')`,
    );
    expect(new Date(rows[1].bucket_start as unknown as string).toISOString().slice(0, 10)).toBe(TODAY);
    expect(Number(rows[1].outflow)).toBe(500);
    expect(Number(rows[2].inflow)).toBe(1000);
  });
});

describe("fechamento mensal", () => {
  it("não fecha o mês corrente", async () => {
    const [year, month] = TODAY.split("-").map(Number);
    const message = await expectError(rpc(org.ownerId, `select public.app_fin_close_period($1, $2)`, [year, month]));
    expect(message).toMatch(/depois que ele termina/);
  });

  it("perfil consulta não fecha; gestor fecha e guarda o retrato do mês", async () => {
    await setRole("consulta");
    const denied = await expectError(rpc(org.adminId, `select public.app_fin_close_period($1, $2)`, [PAST.year, PAST.month]));
    expect(denied).toMatch(/permissão/);

    await setRole("gestor");
    await rpc(org.adminId, `select public.app_fin_close_period($1, $2, 'Conferido com o extrato')`, [PAST.year, PAST.month]);
    const close = await db.query<{ snapshot: { caixa: { net_result: number } } }>(
      `select snapshot from public.fin_period_closes where year = $1 and month = $2 and reopened_at is null`,
      [PAST.year, PAST.month],
    );
    expect(Number(close.rows[0].snapshot.caixa.net_result)).toBe(2200);
  });

  it("mês fechado bloqueia lançar, baixar e estornar com data nele", async () => {
    const blocked = await expectError(
      saveEntry({ kind: "expense", description: "Tardia", amount: 50, category_id: expenseCategory, competence_date: PAST_DAY }),
    );
    expect(blocked).toMatch(/está fechado/);

    const open = await saveEntry({ kind: "expense", description: "Hoje", amount: 40, category_id: expenseCategory, competence_date: TODAY });
    const settle = await expectError(
      rpc(org.ownerId, `select public.app_fin_settle_entry($1, $2::jsonb)`, [open, JSON.stringify({ account_id: checking, settled_on: PAST_DAY })]),
    );
    expect(settle).toMatch(/está fechado/);

    const settlement = await db.query<{ id: string }>(
      `select s.id from public.fin_settlements s join public.fin_entries e on e.id = s.entry_id where e.description = 'Aluguel sala'`,
    );
    const reverse = await expectError(
      rpc(org.ownerId, `select public.app_fin_reverse_settlement($1, 'Teste de estorno em mês fechado')`, [settlement.rows[0].id]),
    );
    expect(reverse).toMatch(/está fechado/);
  });

  it("só administrador reabre, com justificativa", async () => {
    const gestor = await expectError(
      rpc(org.adminId, `select public.app_fin_reopen_period($1, $2, 'Correção de lançamento')`, [PAST.year, PAST.month]),
    );
    expect(gestor).toMatch(/permissão/);
    const short = await expectError(rpc(org.ownerId, `select public.app_fin_reopen_period($1, $2, 'curto')`, [PAST.year, PAST.month]));
    expect(short).toMatch(/10 caracteres/);
    await rpc(org.ownerId, `select public.app_fin_reopen_period($1, $2, 'Correção de lançamento esquecido')`, [PAST.year, PAST.month]);
    await saveEntry({ kind: "expense", description: "Tardia", amount: 50, category_id: expenseCategory, competence_date: PAST_DAY });
  });

  it("checklist aponta pendências do mês", async () => {
    const rows = await rpc<{ check_key: string; quantity: number }>(org.ownerId, `select * from public.fin_close_checklist($1, $2)`, [
      PAST.year,
      PAST.month,
    ]);
    expect(rows.map((row) => row.check_key)).toContain("statement_pending");
  });
});

describe("central de inteligência", () => {
  it("aponta contas vencidas com valor formatado em reais", async () => {
    const rows = await rpc<{ insight_key: string; severity: string; detail: string }>(org.ownerId, `select * from public.fin_insights()`);
    const overdue = rows.find((row) => row.insight_key === "payables_overdue");
    expect(overdue?.severity).toBe("warning");
    // 300 (energia) + 50 (lançado no mês reaberto, já vencido).
    expect(overdue?.detail).toContain("R$ 350,00");
  });

  it("perfil sem acesso não recebe alertas", async () => {
    await setRole("sem_acesso");
    const rows = await rpc(org.adminId, `select * from public.fin_insights()`);
    expect(rows).toHaveLength(0);
  });

  it("formata valores no padrão brasileiro", async () => {
    const row = await one<{ value: string }>(org.ownerId, `select public.fin_brl(1234567.8) as value`);
    expect(row.value).toBe("R$ 1.234.567,80");
  });
});
