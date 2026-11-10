/**
 * Controle Financeiro simplificado (0013): lançamento rápido, recorrências fixas
 * e variáveis, cartões do ano, comissão recebida e importação administrativa.
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
let salaryCategory: string;
let energyCategory: string;
let ownerEmail: string;

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const MONTH_START = `${TODAY.slice(0, 7)}-01`;

async function rpc<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(db, userId, async () => (await db.query<T>(sql, params)).rows);
}

async function one<T>(userId: string, sql: string, params: unknown[] = []): Promise<T> {
  return (await rpc<T>(userId, sql, params))[0];
}

async function categoryByName(name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.fin_categories where organization_id = $1 and name = $2`,
    [org.organizationId, name],
  );
  return result.rows[0].id;
}

async function quick(payload: Record<string, unknown>): Promise<string> {
  const row = await one<{ id: string }>(org.ownerId, `select public.app_fin_quick_entry($1::jsonb) as id`, [JSON.stringify(payload)]);
  return row.id;
}

async function entry(id: string) {
  const result = await db.query<{ status: string; amount: string; recurrence_id: string | null; is_forecast: boolean }>(
    `select status, amount, recurrence_id, is_forecast from public.fin_entries where id = $1`,
    [id],
  );
  return result.rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrganization(db, "Roberta Oliveira Imóveis");
  checking = (
    await one<{ id: string }>(org.ownerId, `select public.app_fin_save_account($1::jsonb) as id`, [
      JSON.stringify({ name: "Itaú", opening_balance: 10000, opening_date: "2025-01-01" }),
    ])
  ).id;
  salaryCategory = await categoryByName("Salários e encargos");
  energyCategory = await categoryByName("Energia elétrica");
  ownerEmail = (await db.query<{ email: string }>(`select email from auth.users where id = $1`, [org.ownerId])).rows[0].email;
});

afterAll(async () => {
  await db?.close();
});

describe("lançamento rápido", () => {
  it("avulso já pago entra no caixa", async () => {
    const id = await quick({ kind: "expense", description: "Café", amount: 35, category_id: energyCategory, date: TODAY, paid: true, account_id: checking });
    expect((await entry(id)).status).toBe("settled");
  });

  it("recorrente fixo: a ocorrência do mês é real e as próximas ficam previstas com o mesmo valor", async () => {
    const id = await quick({
      kind: "expense", description: "Salário recepcionista", amount: 2200, category_id: salaryCategory,
      date: MONTH_START, paid: false, recurring: "fixed",
    });
    const current = await entry(id);
    expect(current.status).toBe("open");
    expect(current.is_forecast).toBe(false);
    const next = await db.query<{ amount: string; status: string }>(
      `select amount, status from public.fin_entries where recurrence_id = $1 and competence_date > $2 order by competence_date`,
      [current.recurrence_id, MONTH_START],
    );
    expect(next.rows.length).toBeGreaterThan(0);
    expect(next.rows.every((row) => Number(row.amount) === 2200 && row.status === "forecast")).toBe(true);
  });

  it("recorrente variável: pagar com outro valor atualiza a estimativa das próximas", async () => {
    const id = await quick({
      kind: "expense", description: "Conta de luz", amount: 480, category_id: energyCategory,
      date: MONTH_START, paid: true, account_id: checking, recurring: "variable",
    });
    const current = await entry(id);
    const next = await db.query<{ id: string; amount: string }>(
      `select id, amount from public.fin_entries where recurrence_id = $1 and competence_date > $2 order by competence_date`,
      [current.recurrence_id, MONTH_START],
    );
    expect(Number(next.rows[0].amount)).toBe(480);

    // Mês seguinte a conta veio 512,30.
    await rpc(org.ownerId, `select public.app_fin_pay_occurrence($1, $2::jsonb)`, [
      next.rows[0].id,
      JSON.stringify({ amount: 512.3, account_id: checking }),
    ]);
    const paid = await entry(next.rows[0].id);
    expect(paid.status).toBe("settled");
    expect(Number(paid.amount)).toBe(512.3);
    if (next.rows[1]) expect(Number((await entry(next.rows[1].id)).amount)).toBe(512.3);
  });
});

describe("cartões do ano", () => {
  it("traz os 12 meses e o mês atual com as contas pendentes", async () => {
    const year = Number(TODAY.slice(0, 4));
    const rows = await rpc<{ month: number; payables_count: number; cash_out: string }>(
      org.ownerId,
      `select * from public.fin_report_year_cards($1)`,
      [year],
    );
    expect(rows).toHaveLength(12);
    const current = rows.find((row) => row.month === Number(TODAY.slice(5, 7)))!;
    expect(current.payables_count).toBeGreaterThanOrEqual(1);
    expect(Number(current.cash_out)).toBeGreaterThanOrEqual(35 + 480);
  });
});

describe("comissão recebida", () => {
  let commissionId: string;

  it("registrar o recebimento lança no caixa; alterar o valor depois é bloqueado", async () => {
    commissionId = (
      await one<{ id: string }>(org.ownerId, `select public.app_save_entry($1::jsonb) as id`, [
        JSON.stringify({
          entry_type: "rental", entry_date: TODAY, description: "Locação casa", property_type: "residential",
          base_amount: 3000, commission_mode: "percentage", commission_rate: 100,
          splits: [{ broker_id: org.brokerIds[0], split_mode: "percentage", split_rate: 40 }],
        }),
      ])
    ).id;
    const operation = await one<{ id: string }>(org.ownerId, `select public.app_fin_register_commission_receipt($1, $2::jsonb) as id`, [
      commissionId,
      JSON.stringify({ account_id: checking, received_on: TODAY }),
    ]);
    const receipts = await rpc<{ entry_id: string; received_on: unknown }>(
      org.ownerId,
      `select * from public.fin_commission_receipts($1::uuid[])`,
      [[commissionId]],
    );
    expect(receipts).toHaveLength(1);

    // Salvar sem mudar valores continua permitido.
    await rpc(org.ownerId, `select public.app_save_entry($1::jsonb, $2)`, [
      JSON.stringify({
        entry_type: "rental", entry_date: TODAY, description: "Locação casa (contrato 12)", property_type: "residential",
        base_amount: 3000, commission_mode: "percentage", commission_rate: 100,
        splits: [{ broker_id: org.brokerIds[0], split_mode: "percentage", split_rate: 40 }],
      }),
      commissionId,
    ]);

    const blocked = await expectError(
      rpc(org.ownerId, `select public.app_save_entry($1::jsonb, $2)`, [
        JSON.stringify({
          entry_type: "rental", entry_date: TODAY, description: "Locação casa", property_type: "residential",
          base_amount: 3500, commission_mode: "percentage", commission_rate: 100,
          splits: [{ broker_id: org.brokerIds[0], split_mode: "percentage", split_rate: 40 }],
        }),
        commissionId,
      ]),
    );
    expect(blocked).toMatch(/Desmarque o recebimento/);

    const deleteBlocked = await expectError(rpc(org.ownerId, `select public.app_delete_entry($1, 'teste')`, [commissionId]));
    expect(deleteBlocked).toMatch(/Desmarque o recebimento/);

    // Desmarcar (cancelar a operação) libera a alteração.
    await rpc(org.ownerId, `select public.app_fin_cancel_operation($1, 'Data de recebimento errada')`, [operation.id]);
    await rpc(org.ownerId, `select public.app_save_entry($1::jsonb, $2)`, [
      JSON.stringify({
        entry_type: "rental", entry_date: TODAY, description: "Locação casa", property_type: "residential",
        base_amount: 3500, commission_mode: "percentage", commission_rate: 100,
        splits: [{ broker_id: org.brokerIds[0], split_mode: "percentage", split_rate: 40 }],
      }),
      commissionId,
    ]);
  });
});

describe("importação administrativa (documentos escaneados)", () => {
  const rows = [
    { date: MONTH_START, description: "Salário Ana (recepção)", kind: "saida", category: "salarios e encargos", amount: 2000, paid: true, payee: "Ana Souza", payee_kind: "employee", recurring: "fixo" },
    { date: TODAY, description: "Conta de água", kind: "saida", category: "Água e esgoto", amount: 132.4, paid: false, recurring: "variavel" },
    { date: TODAY, description: "Material de limpeza", kind: "saida", category: "Limpeza e conservação", amount: 89.9, paid: true },
  ];

  it("usuário autenticado não executa a importação administrativa", async () => {
    const message = await expectError(
      rpc(org.ownerId, `select public.fin_admin_import_entries($1, $2::jsonb, 'x')`, [ownerEmail, JSON.stringify(rows)]),
    );
    expect(message).toMatch(/permission denied|permissão/i);
  });

  it("prévia aponta categoria inexistente e o lote é recusado inteiro", async () => {
    const bad = [...rows, { date: TODAY, description: "Algo", kind: "saida", category: "Categoria que não existe", amount: 10 }];
    const preview = (await db.query<{ problems: string[] }>(`select * from public.fin_admin_preview_import($1, $2::jsonb)`, [ownerEmail, JSON.stringify(bad)])).rows;
    expect(preview[3].problems[0]).toMatch(/categoria não encontrada/);

    const before = (await db.query<{ n: number }>(`select count(*)::integer n from public.fin_entries`)).rows[0].n;
    const message = await expectError(db.query(`select public.fin_admin_import_entries($1, $2::jsonb, 'papéis')`, [ownerEmail, JSON.stringify(bad)]));
    expect(message).toMatch(/Lote recusado/);
    expect((await db.query<{ n: number }>(`select count(*)::integer n from public.fin_entries`)).rows[0].n).toBe(before);
  });

  it("grava como o usuário (com auditoria), cria favorecido e permite desfazer o lote", async () => {
    const result = (
      await db.query<{ result: { batch_id: string; count: number } }>(
        `select public.fin_admin_import_entries($1, $2::jsonb, 'Papéis de novembro') as result`,
        [ownerEmail, JSON.stringify(rows)],
      )
    ).rows[0].result;
    expect(result.count).toBe(3);

    const imported = await db.query<{ created_by: string; origin: string; status: string }>(
      `select created_by, origin, status from public.fin_entries where import_batch_id = $1`,
      [result.batch_id],
    );
    expect(imported.rows).toHaveLength(3);
    expect(imported.rows.every((row) => row.created_by === org.ownerId && row.origin === "import")).toBe(true);
    const payee = await db.query(`select 1 from public.fin_counterparties where name = 'Ana Souza' and kind = 'employee'`);
    expect(payee.rows).toHaveLength(1);

    const undone = (
      await db.query<{ n: number }>(`select public.fin_admin_cancel_import_batch($1, $2, 'Lote importado em duplicidade') as n`, [
        ownerEmail,
        result.batch_id,
      ])
    ).rows[0].n;
    expect(Number(undone)).toBe(3);
    const active = await db.query(`select 1 from public.fin_entries where import_batch_id = $1 and cancelled_at is null`, [result.batch_id]);
    expect(active.rows).toHaveLength(0);
  });
});

describe("migrações reaplicáveis", () => {
  it("reaplicar 0010–0013 não quebra (arquivo combinado pode ser colado de novo)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of ["0010_finance_core.sql", "0011_finance_reconciliation.sql", "0012_finance_reports_close.sql", "0013_finance_simple.sql"]) {
      await db.exec(await fs.readFile(path.join(dir, file), "utf8"));
    }
    const count = await db.query<{ n: number }>(
      `select count(*)::integer n from public.fin_categories where organization_id = $1 and name = 'Energia elétrica'`,
      [org.organizationId],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
