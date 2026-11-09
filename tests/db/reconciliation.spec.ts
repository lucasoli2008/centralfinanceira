/**
 * Controle Financeiro — Fase 2: importação de extrato, conciliação bancária,
 * regras de categorização e recorrências, contra Postgres real (PGlite).
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
let other: SeededOrganization;
let checking: string;
let savings: string;
let rentCategory: string;
let feeCategory: string;
let bankFeeCategory: string;

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
  if (!result.rows[0]) throw new Error(`categoria ${name} não encontrada`);
  return result.rows[0].id;
}

async function categoryByNature(nature: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.fin_categories where organization_id = $1 and nature = $2 and parent_id is not null
     order by name limit 1`,
    [org.organizationId, nature],
  );
  return result.rows[0].id;
}

async function saveEntry(payload: Record<string, unknown>): Promise<string> {
  const row = await one<{ ids: string[] }>(org.ownerId, `select public.app_fin_save_entry($1::jsonb) as ids`, [
    JSON.stringify(payload),
  ]);
  return row.ids[0];
}

async function importLines(accountId: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const row = await one<{ result: { inserted: number; duplicated: number; total: number } }>(
    org.ownerId,
    `select public.app_fin_import_statement($1, $2::jsonb) as result`,
    [accountId, JSON.stringify({ format: "ofx", file_name: "extrato.ofx", lines, ...extra })],
  );
  return row.result;
}

async function lineByExternal(externalId: string) {
  const result = await db.query<{ id: string; status: string; matched_entry_id: string | null; matched_settlement_id: string | null }>(
    `select id, status, matched_entry_id, matched_settlement_id from public.fin_statement_lines where external_id = $1`,
    [externalId],
  );
  return result.rows[0];
}

async function balance(accountId: string): Promise<number> {
  const row = await one<{ balance: string }>(
    org.ownerId,
    `select balance from public.fin_account_balances('2100-01-01') where account_id = $1`,
    [accountId],
  );
  return Number(row.balance);
}

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrganization(db, "Roberta Oliveira Imóveis");
  other = await seedOrganization(db, "Outra");
  const save = async (payload: Record<string, unknown>) =>
    (await one<{ id: string }>(org.ownerId, `select public.app_fin_save_account($1::jsonb) as id`, [JSON.stringify(payload)])).id;
  checking = await save({ name: "Itaú", opening_balance: 1000, opening_date: "2026-01-01" });
  savings = await save({ name: "Poupança", kind: "savings" });
  rentCategory = await categoryByNature("operating_expense");
  feeCategory = await categoryByNature("own_revenue");
  bankFeeCategory = await categoryByName("Tarifas bancárias").catch(() => rentCategory);
});

afterAll(async () => {
  await db?.close();
});

describe("importação de extrato", () => {
  it("é idempotente por linha (FITID)", async () => {
    const lines = [
      { external_id: "FIT-1", posted_on: "2026-03-05", amount: -350, description: "PAG BOLETO ENERGIA" },
      { external_id: "FIT-2", posted_on: "2026-03-06", amount: 1200, description: "PIX RECEBIDO TAXA ADM" },
    ];
    const first = await importLines(checking, lines, { statement_balance: 1850, statement_balance_date: "2026-03-06" });
    expect(first).toMatchObject({ total: 2, inserted: 2, duplicated: 0 });

    const again = await importLines(checking, [
      ...lines,
      { external_id: "FIT-3", posted_on: "2026-03-07", amount: -15.9, description: "TARIFA PACOTE SERVICOS" },
    ]);
    expect(again).toMatchObject({ total: 3, inserted: 1, duplicated: 2 });
  });

  it("não move dinheiro: o saldo do sistema não muda ao importar", async () => {
    expect(await balance(checking)).toBe(1000);
  });

  it("recusa linha sem valor", async () => {
    const message = await expectError(
      importLines(checking, [{ external_id: "X", posted_on: "2026-03-01", amount: 0, description: "zero" }]),
    );
    expect(message).toMatch(/sem valor/);
  });
});

describe("conciliação", () => {
  it("sugere e confirma o par inequívoco com uma baixa já registrada", async () => {
    // Conta de energia paga manualmente no sistema, um dia depois da data do banco.
    await saveEntry({
      kind: "expense", description: "Energia março", amount: 350, category_id: rentCategory,
      competence_date: "2026-03-04", settle_now: true, account_id: checking, settled_on: "2026-03-04",
    });
    const suggestions = await rpc<{ line_id: string }>(org.ownerId, `select * from public.fin_reconciliation_suggestions($1)`, [checking]);
    const line = await lineByExternal("FIT-1");
    expect(suggestions.map((row) => row.line_id)).toEqual([line.id]);

    const confirmed = await one<{ total: number }>(org.ownerId, `select public.app_fin_confirm_suggestions($1) as total`, [checking]);
    expect(Number(confirmed.total)).toBe(1);
    expect((await lineByExternal("FIT-1")).status).toBe("matched");
    // Conciliar não altera o saldo: 1000 − 350.
    expect(await balance(checking)).toBe(650);
  });

  it("baixa uma conta a receber a partir da linha do extrato", async () => {
    const receivable = await saveEntry({
      kind: "income", description: "Taxa de administração", amount: 1200, category_id: feeCategory,
      competence_date: "2026-03-01", due_date: "2026-03-05",
    });
    const line = await lineByExternal("FIT-2");
    const candidates = await rpc<{ candidate_type: string; entry_id: string; exact: boolean }>(
      org.ownerId,
      `select * from public.fin_line_candidates($1)`,
      [line.id],
    );
    expect(candidates.some((row) => row.candidate_type === "open_entry" && row.entry_id === receivable && row.exact)).toBe(true);

    await rpc(org.ownerId, `select public.app_fin_settle_from_line($1, $2)`, [line.id, receivable]);
    const entry = await db.query<{ status: string }>(`select status from public.fin_entries where id = $1`, [receivable]);
    expect(entry.rows[0].status).toBe("settled");
    expect((await lineByExternal("FIT-2")).status).toBe("matched");
    expect(await balance(checking)).toBe(1850);
  });

  it("não deixa a mesma linha ou o mesmo movimento ser conciliado duas vezes", async () => {
    const line = await lineByExternal("FIT-2");
    const message = await expectError(
      rpc(org.ownerId, `select public.app_fin_match_line($1, $2, $3)`, [line.id, line.matched_entry_id, line.matched_settlement_id]),
    );
    expect(message).toMatch(/já foi conciliada/);
  });

  it("recusa ligar movimentos com valor diferente", async () => {
    await importLines(checking, [{ external_id: "FIT-4", posted_on: "2026-03-10", amount: -99.99, description: "COMPRA" }]);
    const other = await saveEntry({
      kind: "expense", description: "Material", amount: 100, category_id: rentCategory,
      competence_date: "2026-03-10", settle_now: true, account_id: checking,
    });
    const settlement = await db.query<{ id: string }>(`select id from public.fin_settlements where entry_id = $1`, [other]);
    const line = await lineByExternal("FIT-4");
    const message = await expectError(
      rpc(org.ownerId, `select public.app_fin_match_line($1, $2, $3)`, [line.id, other, settlement.rows[0].id]),
    );
    expect(message).toMatch(/mesmo valor/);
  });

  it("estornar a baixa desfaz a conciliação ligada", async () => {
    const line = await lineByExternal("FIT-1");
    await rpc(org.ownerId, `select public.app_fin_reverse_settlement($1, 'Pagamento lançado em duplicidade')`, [line.matched_settlement_id]);
    expect((await lineByExternal("FIT-1")).status).toBe("pending");
  });

  it("cria transferência a partir de uma saída do extrato", async () => {
    await importLines(checking, [{ external_id: "FIT-5", posted_on: "2026-03-12", amount: -500, description: "TRANSF POUPANCA" }]);
    const line = await lineByExternal("FIT-5");
    await rpc(org.ownerId, `select public.app_fin_create_from_line($1, $2::jsonb)`, [
      line.id,
      JSON.stringify({ kind: "transfer", other_account_id: savings }),
    ]);
    expect(await balance(savings)).toBe(500);
    expect((await lineByExternal("FIT-5")).status).toBe("matched");
  });

  it("ignorar exige justificativa", async () => {
    const line = await lineByExternal("FIT-4");
    const message = await expectError(rpc(org.ownerId, `select public.app_fin_ignore_line($1, 'curto')`, [line.id]));
    expect(message).toMatch(/10 caracteres/);
    await rpc(org.ownerId, `select public.app_fin_ignore_line($1, 'Estorno do próprio banco no mesmo dia')`, [line.id]);
    expect((await lineByExternal("FIT-4")).status).toBe("ignored");
    await rpc(org.ownerId, `select public.app_fin_unmatch_line($1)`, [line.id]);
    expect((await lineByExternal("FIT-4")).status).toBe("pending");
  });

  it("resume a diferença entre o extrato e o sistema", async () => {
    const summary = await one<Record<string, string | null>>(org.ownerId, `select * from public.fin_reconciliation_summary($1)`, [checking]);
    expect(Number(summary.statement_balance)).toBe(1850);
    expect(summary.statement_balance_date).toBeTruthy();
    expect(Number(summary.pending_lines)).toBeGreaterThan(0);
    expect(summary.difference).not.toBeNull();
  });
});

describe("regras", () => {
  it("aplica a regra mais prioritária, sem acento e sem caixa, e cria o lançamento ao confirmar", async () => {
    await rpc(org.ownerId, `select public.app_fin_save_rule($1::jsonb)`, [
      JSON.stringify({ name: "Tarifas", match_text: "tarifa pacote", match_direction: "expense", category_id: bankFeeCategory, priority: 10 }),
    ]);
    const listed = await rpc<{ id: string; rule_name: string | null }>(
      org.ownerId,
      `select id, rule_name from public.fin_statement_lines_list($1, 'pending')`,
      [checking],
    );
    const line = await lineByExternal("FIT-3");
    expect(listed.find((row) => row.id === line.id)?.rule_name).toBe("Tarifas");

    const created = await one<{ total: number }>(org.ownerId, `select public.app_fin_create_from_rules($1::uuid[]) as total`, [[line.id]]);
    expect(Number(created.total)).toBe(1);
    expect((await lineByExternal("FIT-3")).status).toBe("matched");
    const rule = await db.query<{ times_applied: number }>(`select times_applied from public.fin_rules where name = 'Tarifas'`);
    expect(rule.rows[0].times_applied).toBe(1);
  });

  it("a regra também sugere a categoria no formulário de lançamento", async () => {
    const row = await one<{ category_id: string; reason: string }>(
      org.ownerId,
      `select * from public.fin_suggest_category('expense', 'TARIFA PACOTE SERVIÇOS ABRIL')`,
    );
    expect(row.category_id).toBe(bankFeeCategory);
    expect(row.reason).toMatch(/Regra/);
  });

  it("recusa categoria incompatível com a direção", async () => {
    const message = await expectError(
      rpc(org.ownerId, `select public.app_fin_save_rule($1::jsonb)`, [
        JSON.stringify({ name: "Errada", match_text: "xx", match_direction: "income", category_id: rentCategory }),
      ]),
    );
    expect(message).toMatch(/não combina/);
  });
});

describe("recorrências", () => {
  it("gera previsões mensais sem efeito no razão e sem duplicar", async () => {
    const start = new Date();
    const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    const recurrence = await one<{ id: string }>(org.ownerId, `select public.app_fin_save_recurrence($1::jsonb) as id`, [
      JSON.stringify({ kind: "expense", description: "Aluguel do escritório", amount: 3000, category_id: rentCategory, start_date: startDate }),
    ]);
    const count = async () =>
      Number(
        (
          await db.query<{ total: number }>(
            `select count(*)::integer as total from public.fin_entries where recurrence_id = $1 and cancelled_at is null`,
            [recurrence.id],
          )
        ).rows[0].total,
      );
    const generated = await count();
    expect(generated).toBeGreaterThanOrEqual(3);

    const postings = await db.query<{ total: number }>(
      `select count(*)::integer as total from public.fin_postings p join public.fin_entries e on e.id = p.entry_id where e.recurrence_id = $1`,
      [recurrence.id],
    );
    expect(postings.rows[0].total).toBe(0);

    await rpc(org.ownerId, `select public.app_fin_generate_recurrences(90)`);
    expect(await count()).toBe(generated);

    // Edição refaz as previsões futuras com o novo valor.
    await rpc(org.ownerId, `select public.app_fin_save_recurrence($1::jsonb, $2)`, [
      JSON.stringify({ kind: "expense", description: "Aluguel do escritório", amount: 3200, category_id: rentCategory, start_date: startDate }),
      recurrence.id,
    ]);
    const amounts = await db.query<{ amount: string }>(
      `select amount from public.fin_entries where recurrence_id = $1 and cancelled_at is null and competence_date >= public.fin_today()`,
      [recurrence.id],
    );
    expect(amounts.rows.length).toBeGreaterThan(0);
    expect(amounts.rows.every((row) => Number(row.amount) === 3200)).toBe(true);
  });
});

describe("permissões", () => {
  it("outra organização não vê o extrato nem concilia", async () => {
    const lines = await rpc<{ id: string }>(other.ownerId, `select id from public.fin_statement_lines`);
    expect(lines).toHaveLength(0);
    const line = await lineByExternal("FIT-1");
    const message = await expectError(rpc(other.ownerId, `select public.app_fin_ignore_line($1, 'tentativa externa de ignorar')`, [line.id]));
    expect(message).toMatch(/não encontrada/);
  });

  it("perfil consulta não importa extrato", async () => {
    await rpc(org.ownerId, `select public.app_set_member_finance_role(id, 'consulta') from public.organization_members where user_id = $1`, [
      org.adminId,
    ]);
    const message = await expectError(
      asUser(db, org.adminId, () =>
        db.query(`select public.app_fin_import_statement($1, $2::jsonb)`, [
          checking,
          JSON.stringify({ format: "csv", lines: [{ external_id: "Z", posted_on: "2026-03-01", amount: 1, description: "x" }] }),
        ]),
      ),
    );
    expect(message).toMatch(/permissão/);
  });

  it("insert direto em linhas do extrato é bloqueado por RLS", async () => {
    const message = await expectError(
      asUser(db, org.ownerId, () =>
        db.query(
          `insert into public.fin_statement_lines (organization_id, account_id, import_id, external_id, posted_on, amount, description)
           select organization_id, account_id, id, 'hack', '2026-03-01', 1, 'x' from public.fin_bank_imports limit 1`,
        ),
      ),
    );
    expect(message).toMatch(/row-level security|violates/);
  });
});
