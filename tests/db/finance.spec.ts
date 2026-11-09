/**
 * Testes de aceitação do Controle Financeiro (Fase 1) contra Postgres real
 * (PGlite): livro-razão balanceado, separação entre receita própria e dinheiro
 * de terceiros, contas a pagar/receber, transferências e permissões.
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
let roberta: SeededOrganization;
let outra: SeededOrganization;
let checking: string;
let savings: string;

const TODAY = new Date().toISOString().slice(0, 10);

async function rpc<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<T>(sql, params);
    return result.rows;
  });
}

async function categoryId(org: string, systemKey: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.fin_categories where organization_id = $1 and system_key = $2`,
    [org, systemKey],
  );
  return result.rows[0].id;
}

async function categoryByName(org: string, name: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    `select id from public.fin_categories where organization_id = $1 and name = $2`,
    [org, name],
  );
  return result.rows[0].id;
}

async function saveAccount(userId: string, payload: Record<string, unknown>): Promise<string> {
  const rows = await rpc<{ id: string }>(
    userId,
    `select public.app_fin_save_account($1::jsonb) as id`,
    [JSON.stringify(payload)],
  );
  return rows[0].id;
}

async function saveEntry(userId: string, payload: Record<string, unknown>, entryId?: string): Promise<string[]> {
  const rows = await rpc<{ ids: string[] }>(
    userId,
    `select public.app_fin_save_entry($1::jsonb, $2::uuid) as ids`,
    [JSON.stringify(payload), entryId ?? null],
  );
  return rows[0].ids;
}

async function balance(userId: string, accountId: string): Promise<number> {
  const rows = await rpc<{ balance: string }>(
    userId,
    `select balance from public.fin_account_balances() where account_id = $1`,
    [accountId],
  );
  return Number(rows[0].balance);
}

async function summary(userId: string, regime = "caixa") {
  const rows = await rpc<Record<string, string>>(
    userId,
    `select * from public.fin_report_summary('2000-01-01'::date, '2100-12-31'::date, $1)`,
    [regime],
  );
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

async function entry(entryId: string) {
  const rows = await db.query<{ status: string; settled_amount: string; amount: string }>(
    `select status, settled_amount, amount from public.fin_entries where id = $1`,
    [entryId],
  );
  return rows.rows[0];
}

beforeAll(async () => {
  db = await createTestDatabase();
  roberta = await seedOrganization(db, "Roberta Oliveira Imóveis");
  outra = await seedOrganization(db, "Outra Imobiliária");
  checking = await saveAccount(roberta.ownerId, { name: "Conta corrente", opening_balance: 5000, opening_date: "2026-01-01" });
  savings = await saveAccount(roberta.ownerId, { name: "Poupança", kind: "savings" });
});

afterAll(async () => {
  await db?.close();
});

describe("estrutura", () => {
  it("cria o plano de categorias padrão para cada organização", async () => {
    const result = await db.query<{ total: number }>(
      `select count(*)::integer as total from public.fin_categories where organization_id = $1`,
      [roberta.organizationId],
    );
    expect(result.rows[0].total).toBeGreaterThan(30);
    expect(await categoryId(roberta.organizationId, "admin_fee")).toBeTruthy();
    expect(await categoryId(outra.organizationId, "owner_transfer")).toBeTruthy();
  });

  it("registra o saldo inicial da conta no livro-razão", async () => {
    expect(await balance(roberta.ownerId, checking)).toBe(5000);
    expect(await balance(roberta.ownerId, savings)).toBe(0);
  });

  it("mantém todos os lotes do livro-razão balanceados", async () => {
    const result = await db.query<{ unbalanced: number }>(
      `select count(*)::integer as unbalanced from (
         select batch_id from public.fin_postings group by batch_id having sum(amount) <> 0
       ) x`,
    );
    expect(result.rows[0].unbalanced).toBe(0);
  });

  it("impede alterar partidas diretamente", async () => {
    const message = await expectError(
      db.query(`update public.fin_postings set amount = amount * 2`),
    );
    expect(message).toContain("imutáveis");
  });
});

describe("Teste 1 e 2 — receita própria e despesa paga", () => {
  it("receita recebida aumenta caixa e resultado; despesa paga reduz o saldo", async () => {
    const before = await summary(roberta.ownerId);
    const startBalance = await balance(roberta.ownerId, checking);

    await saveEntry(roberta.ownerId, {
      kind: "income",
      description: "Taxa de intermediação — Casa Jardim",
      amount: 2500,
      category_id: await categoryByName(roberta.organizationId, "Taxa de intermediação"),
      account_id: checking,
      competence_date: TODAY,
      settle_now: true,
    });

    await saveEntry(roberta.ownerId, {
      kind: "expense",
      description: "Aluguel da sede",
      amount: 1800,
      category_id: await categoryByName(roberta.organizationId, "Aluguel da sede"),
      account_id: checking,
      competence_date: TODAY,
      settle_now: true,
    });

    const after = await summary(roberta.ownerId);
    expect(await balance(roberta.ownerId, checking)).toBe(startBalance + 2500 - 1800);
    expect(after.own_revenue - before.own_revenue).toBe(2500);
    expect(after.operating_expenses - before.operating_expenses).toBe(1800);
    expect(after.net_result - before.net_result).toBe(700);
  });
});

describe("Teste 3 — contas a pagar", () => {
  it("obrigação futura não reduz o caixa nem conta como paga; baixa parcial muda o status", async () => {
    const startBalance = await balance(roberta.ownerId, checking);
    const before = await summary(roberta.ownerId);

    const [billId] = await saveEntry(roberta.ownerId, {
      kind: "expense",
      description: "Contabilidade de março",
      amount: 900,
      category_id: await categoryByName(roberta.organizationId, "Contabilidade e jurídico"),
      account_id: checking,
      competence_date: TODAY,
      due_date: "2099-03-10",
    });

    expect((await entry(billId)).status).toBe("open");
    expect(await balance(roberta.ownerId, checking)).toBe(startBalance);
    const afterCreate = await summary(roberta.ownerId);
    expect(afterCreate.payables_open - before.payables_open).toBe(900);
    expect(afterCreate.cash_out).toBe(before.cash_out);

    await rpc(roberta.ownerId, `select public.app_fin_settle_entry($1::uuid, $2::jsonb)`, [
      billId,
      JSON.stringify({ amount: 400, settled_on: TODAY }),
    ]);
    expect((await entry(billId)).status).toBe("partial");
    expect(await balance(roberta.ownerId, checking)).toBe(startBalance - 400);

    const overpay = await expectError(
      rpc(roberta.ownerId, `select public.app_fin_settle_entry($1::uuid, $2::jsonb)`, [
        billId,
        JSON.stringify({ amount: 600, settled_on: TODAY }),
      ]),
    );
    expect(overpay).toContain("maior que o saldo em aberto");

    await rpc(roberta.ownerId, `select public.app_fin_settle_entry($1::uuid, $2::jsonb)`, [
      billId,
      JSON.stringify({ settled_on: TODAY }),
    ]);
    const settled = await entry(billId);
    expect(settled.status).toBe("settled");
    expect(Number(settled.settled_amount)).toBe(900);
  });

  it("previsão não gera obrigação até ser confirmada", async () => {
    const before = await summary(roberta.ownerId);
    const [forecastId] = await saveEntry(roberta.ownerId, {
      kind: "expense",
      description: "Previsão de manutenção",
      amount: 300,
      category_id: await categoryByName(roberta.organizationId, "Manutenção e obras"),
      competence_date: TODAY,
      due_date: "2099-04-01",
      is_forecast: true,
    });
    expect((await entry(forecastId)).status).toBe("forecast");
    expect((await summary(roberta.ownerId)).payables_open).toBe(before.payables_open);

    await rpc(roberta.ownerId, `select public.app_fin_confirm_forecast($1::uuid)`, [forecastId]);
    expect((await entry(forecastId)).status).toBe("open");
    expect((await summary(roberta.ownerId)).payables_open - before.payables_open).toBe(300);
  });

  it("parcela em valores que somam exatamente o total", async () => {
    const ids = await saveEntry(roberta.ownerId, {
      kind: "expense",
      description: "Notebook",
      amount: 1000,
      category_id: await categoryByName(roberta.organizationId, "Material de escritório"),
      competence_date: TODAY,
      due_date: "2099-01-15",
      installments: 3,
    });
    expect(ids).toHaveLength(3);
    const rows = await db.query<{ amount: string; due_date: string }>(
      `select amount, due_date::text from public.fin_entries where id = any($1::uuid[]) order by installment_number`,
      [ids],
    );
    expect(rows.rows.map((row) => row.amount)).toEqual(["333.33", "333.33", "333.34"]);
    expect(rows.rows.map((row) => row.due_date)).toEqual(["2099-01-15", "2099-02-15", "2099-03-15"]);
  });
});

describe("Teste 4 — transferência entre contas próprias", () => {
  it("move saldo sem criar receita nem despesa", async () => {
    const before = await summary(roberta.ownerId);
    const checkingBefore = await balance(roberta.ownerId, checking);
    const savingsBefore = await balance(roberta.ownerId, savings);

    await saveEntry(roberta.ownerId, {
      kind: "transfer",
      description: "Reserva para a poupança",
      amount: 1000,
      account_id: checking,
      transfer_account_id: savings,
      competence_date: TODAY,
    });

    const after = await summary(roberta.ownerId);
    expect(await balance(roberta.ownerId, checking)).toBe(checkingBefore - 1000);
    expect(await balance(roberta.ownerId, savings)).toBe(savingsBefore + 1000);
    expect(after.cash_balance).toBe(before.cash_balance);
    expect(after.own_revenue).toBe(before.own_revenue);
    expect(after.net_result).toBe(before.net_result);
    expect(after.cash_in).toBe(before.cash_in);
    expect(after.cash_out).toBe(before.cash_out);
  });

  it("ajuste de saldo exige justificativa", async () => {
    const message = await expectError(
      saveEntry(roberta.ownerId, {
        kind: "adjustment",
        description: "Ajuste",
        amount: 10,
        account_id: checking,
        adjustment_direction: "decrease",
        competence_date: TODAY,
      }),
    );
    expect(message).toContain("justificativa");
  });
});

describe("Teste 5 — repasse imobiliário (aluguel)", () => {
  it("recebe R$ 10.000, reconhece só R$ 1.000 de receita e cria R$ 9.000 de obrigação", async () => {
    const owner = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_save_counterparty($1::jsonb) as id`,
      [JSON.stringify({ name: "Maria Proprietária", kind: "owner" })],
    );
    const property = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_save_property($1::jsonb) as id`,
      [JSON.stringify({ label: "Apto 302 — Aurora", owner_counterparty_id: owner[0].id, admin_fee_rate: 10 })],
    );

    const before = await summary(roberta.ownerId);
    const cashBefore = await balance(roberta.ownerId, checking);

    const operation = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_register_rental_collection($1::jsonb) as id`,
      [JSON.stringify({ property_id: property[0].id, rent_amount: 10000, received_on: TODAY, account_id: checking, reference: "03/2026" })],
    );

    const after = await summary(roberta.ownerId);
    expect(await balance(roberta.ownerId, checking)).toBe(cashBefore + 10000);
    expect(after.own_revenue - before.own_revenue).toBe(1000);
    expect(after.third_party_obligations - before.third_party_obligations).toBe(9000);
    expect(after.net_result - before.net_result).toBe(1000);
    // O caixa recebeu 10 mil, mas o disponível próprio só cresceu a parte da imobiliária.
    expect(after.own_available - before.own_available).toBe(1000);

    // Pagar o repasse zera a obrigação e não mexe no resultado.
    const payout = await db.query<{ id: string }>(
      `select id from public.fin_entries where operation_id = $1 and kind = 'expense'`,
      [operation[0].id],
    );
    await rpc(roberta.ownerId, `select public.app_fin_settle_entry($1::uuid, $2::jsonb)`, [
      payout.rows[0].id,
      JSON.stringify({ settled_on: TODAY }),
    ]);
    const paid = await summary(roberta.ownerId);
    expect(paid.third_party_obligations).toBe(before.third_party_obligations);
    expect(paid.net_result).toBe(after.net_result);
    expect(await balance(roberta.ownerId, checking)).toBe(cashBefore + 1000);
  });

  it("cancelar a operação desfaz caixa, receita e obrigação", async () => {
    const owner = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_save_counterparty($1::jsonb) as id`,
      [JSON.stringify({ name: "João Proprietário", kind: "owner" })],
    );
    const before = await summary(roberta.ownerId);
    const cashBefore = await balance(roberta.ownerId, checking);

    const operation = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_register_rental_collection($1::jsonb) as id`,
      [JSON.stringify({ owner_counterparty_id: owner[0].id, rent_amount: 3000, admin_fee_amount: 240, received_on: TODAY, account_id: checking })],
    );
    await rpc(roberta.ownerId, `select public.app_fin_cancel_operation($1::uuid, $2)`, [
      operation[0].id,
      "Aluguel lançado na conta errada",
    ]);

    const after = await summary(roberta.ownerId);
    expect(await balance(roberta.ownerId, checking)).toBe(cashBefore);
    expect(after.own_revenue).toBe(before.own_revenue);
    expect(after.third_party_obligations).toBe(before.third_party_obligations);
  });
});

describe("Teste 6 — comissão de venda", () => {
  it("lança só a comissão (nunca o valor do imóvel) e separa a parte dos corretores", async () => {
    const commission = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_save_entry($1::jsonb) as id`,
      [
        JSON.stringify({
          entry_type: "sale",
          entry_date: TODAY,
          description: "Venda Apartamento Centro",
          property_type: "residential",
          base_amount: 500000,
          commission_mode: "percentage",
          commission_rate: 6,
          splits: [{ broker_id: roberta.brokerIds[0], split_mode: "percentage", split_rate: 40 }],
        }),
      ],
    );

    const before = await summary(roberta.ownerId);
    expect(before.commissions_not_in_cash).toBeGreaterThanOrEqual(30000);
    const cashBefore = await balance(roberta.ownerId, checking);

    await rpc(roberta.ownerId, `select public.app_fin_register_commission_receipt($1::uuid, $2::jsonb)`, [
      commission[0].id,
      JSON.stringify({ account_id: checking, received_on: TODAY }),
    ]);

    const after = await summary(roberta.ownerId);
    expect(await balance(roberta.ownerId, checking)).toBe(cashBefore + 30000);
    expect(after.own_revenue - before.own_revenue).toBe(18000);
    expect(after.broker_payouts_pending - before.broker_payouts_pending).toBe(12000);
    expect(after.third_party_obligations - before.third_party_obligations).toBe(12000);
    expect(before.commissions_not_in_cash - after.commissions_not_in_cash).toBe(30000);

    const duplicate = await expectError(
      rpc(roberta.ownerId, `select public.app_fin_register_commission_receipt($1::uuid, $2::jsonb)`, [
        commission[0].id,
        JSON.stringify({ account_id: checking, received_on: TODAY }),
      ]),
    );
    expect(duplicate).toContain("já foi lançada");
  });
});

describe("estornos e cancelamentos", () => {
  it("estornar uma baixa devolve o lançamento para aberto e o saldo ao valor anterior", async () => {
    const cashBefore = await balance(roberta.ownerId, checking);
    const [id] = await saveEntry(roberta.ownerId, {
      kind: "expense",
      description: "Combustível",
      amount: 150,
      category_id: await categoryByName(roberta.organizationId, "Transporte e combustível"),
      account_id: checking,
      competence_date: TODAY,
      settle_now: true,
    });
    const settlement = await db.query<{ id: string }>(
      `select id from public.fin_settlements where entry_id = $1`,
      [id],
    );

    await rpc(roberta.ownerId, `select public.app_fin_reverse_settlement($1::uuid, $2)`, [
      settlement.rows[0].id,
      "Pagamento lançado em duplicidade",
    ]);
    expect((await entry(id)).status).toBe("open");
    expect(await balance(roberta.ownerId, checking)).toBe(cashBefore);

    await rpc(roberta.ownerId, `select public.app_fin_cancel_entry($1::uuid, $2)`, [id, "Despesa não era da empresa"]);
    expect((await entry(id)).status).toBe("cancelled");
  });

  it("editar valor de um título em aberto reposta o razão sem deixar resíduo", async () => {
    const before = await summary(roberta.ownerId);
    const [id] = await saveEntry(roberta.ownerId, {
      kind: "income",
      description: "Taxa extra",
      amount: 100,
      category_id: await categoryByName(roberta.organizationId, "Receitas diversas"),
      competence_date: TODAY,
      due_date: "2099-05-01",
    });
    await saveEntry(
      roberta.ownerId,
      {
        kind: "income",
        description: "Taxa extra",
        amount: 250,
        category_id: await categoryByName(roberta.organizationId, "Receitas diversas"),
        competence_date: TODAY,
        due_date: "2099-05-01",
      },
      id,
    );
    const after = await summary(roberta.ownerId, "competencia");
    const beforeCompetence = before; // receivables independem do regime
    expect(after.receivables_open - beforeCompetence.receivables_open).toBe(250);
  });

  it("rejeita categoria de receita em uma saída", async () => {
    const message = await expectError(
      saveEntry(roberta.ownerId, {
        kind: "expense",
        description: "Errado",
        amount: 10,
        category_id: await categoryId(roberta.organizationId, "admin_fee"),
        competence_date: TODAY,
      }),
    );
    expect(message).toContain("categoria é de receita");
  });
});

describe("sugestão de categoria", () => {
  it("sugere pelo favorecido e explica de onde veio, sem aplicar nada", async () => {
    const agency = await rpc<{ id: string }>(
      roberta.ownerId,
      `select public.app_fin_save_counterparty($1::jsonb) as id`,
      [JSON.stringify({ name: "Agência Vitrine", kind: "supplier" })],
    );
    const marketing = await categoryByName(roberta.organizationId, "Marketing e anúncios");
    for (const month of ["01", "02"]) {
      await saveEntry(roberta.ownerId, {
        kind: "expense",
        description: `Campanha de anúncios ${month}`,
        amount: 500,
        category_id: marketing,
        counterparty_id: agency[0].id,
        competence_date: `2026-${month}-10`,
      });
    }

    const suggestion = await rpc<{ category_id: string; matches: number; reason: string }>(
      roberta.ownerId,
      `select * from public.fin_suggest_category('expense', 'Impulsionamento redes', $1::uuid)`,
      [agency[0].id],
    );
    expect(suggestion[0].category_id).toBe(marketing);
    expect(suggestion[0].matches).toBe(2);
    expect(suggestion[0].reason).toContain("este favorecido");

    const byDescription = await rpc<{ category_id: string }>(
      roberta.ownerId,
      `select * from public.fin_suggest_category('expense', 'Campanha de anúncios 03', null)`,
    );
    expect(byDescription[0].category_id).toBe(marketing);

    const none = await rpc<{ category_id: string }>(
      roberta.ownerId,
      `select * from public.fin_suggest_category('income', 'xyz sem histórico', null)`,
    );
    expect(none).toHaveLength(0);
  });
});

describe("Teste 11 — permissões", () => {
  it("usuário de outra organização não enxerga nada", async () => {
    const entries = await rpc<{ id: string }>(outra.ownerId, `select id from public.fin_entries`);
    expect(entries).toHaveLength(0);
    const balances = await rpc<{ account_id: string }>(outra.ownerId, `select * from public.fin_account_balances()`);
    expect(balances).toHaveLength(0);
  });

  it("perfil 'consulta' lê mas não escreve; 'sem_acesso' não lê", async () => {
    await rpc(roberta.ownerId, `select public.app_set_member_finance_role(id, 'consulta') from public.organization_members where user_id = $1`, [
      roberta.adminId,
    ]);
    const visible = await rpc<{ id: string }>(roberta.adminId, `select id from public.fin_entries limit 1`);
    expect(visible.length).toBe(1);
    const denied = await expectError(
      saveEntry(roberta.adminId, {
        kind: "income",
        description: "Tentativa",
        amount: 1,
        category_id: await categoryId(roberta.organizationId, "admin_fee"),
        competence_date: TODAY,
      }),
    );
    expect(denied).toContain("permissão");

    await rpc(roberta.ownerId, `select public.app_set_member_finance_role(id, 'sem_acesso') from public.organization_members where user_id = $1`, [
      roberta.adminId,
    ]);
    const hidden = await rpc<{ id: string }>(roberta.adminId, `select id from public.fin_entries limit 1`);
    expect(hidden).toHaveLength(0);

    await rpc(roberta.ownerId, `select public.app_set_member_finance_role(id, 'financeiro') from public.organization_members where user_id = $1`, [
      roberta.adminId,
    ]);
  });

  it("nem quem pode escrever grava partidas ou baixas fora das RPCs", async () => {
    const batch = await db.query<{ id: string; entry_id: string }>(
      `select id, entry_id from public.fin_ledger_batches where organization_id = $1 limit 1`,
      [roberta.organizationId],
    );
    const message = await expectError(
      rpc(roberta.adminId, `insert into public.fin_postings (organization_id, batch_id, entry_id, posting_date, bucket, account_id, amount)
        values ($1, $2, $3, current_date, 'cash', $4, 1000)`, [
        roberta.organizationId,
        batch.rows[0].id,
        batch.rows[0].entry_id,
        checking,
      ]),
    );
    expect(message).toMatch(/row-level security|violates/);
  });

  it("somente o proprietário altera perfis financeiros", async () => {
    const message = await expectError(
      rpc(roberta.adminId, `select public.app_set_member_finance_role(id, 'admin') from public.organization_members where user_id = $1`, [
        roberta.adminId,
      ]),
    );
    expect(message).toContain("Somente o proprietário");
  });
});

describe("Teste 12 — coerência entre relatórios", () => {
  it("resumo, série mensal e categorias somam o mesmo resultado", async () => {
    const from = "2026-01-01";
    const to = "2100-12-31";
    const total = await rpc<{ net_result: string; cash_in: string; cash_out: string }>(
      roberta.ownerId,
      `select net_result, cash_in, cash_out from public.fin_report_summary($1::date, $2::date, 'caixa')`,
      [from, to],
    );
    const monthly = await rpc<{ result: string; cash_in: string; cash_out: string }>(
      roberta.ownerId,
      `select result, cash_in, cash_out from public.fin_report_monthly($1::date, '2027-12-31'::date, 'caixa')`,
      [from],
    );
    const sum = (key: "result" | "cash_in" | "cash_out") =>
      Math.round(monthly.reduce((acc, row) => acc + Number(row[key]), 0) * 100) / 100;

    expect(sum("result")).toBe(Number(total[0].net_result));
    expect(sum("cash_in")).toBe(Number(total[0].cash_in));
    expect(sum("cash_out")).toBe(Number(total[0].cash_out));

    const revenueByCategory = await rpc<{ total: string; nature: string }>(
      roberta.ownerId,
      `select total, nature from public.fin_report_by_category($1::date, $2::date, 'caixa', 'income')`,
      [from, to],
    );
    const ownFromCategories = revenueByCategory
      .filter((row) => row.nature === "own_revenue" || row.nature === "other_revenue")
      .reduce((acc, row) => acc + Number(row.total), 0);
    const summaryRow = await summary(roberta.ownerId);
    expect(Math.round(ownFromCategories * 100) / 100).toBe(
      Math.round((summaryRow.own_revenue + summaryRow.other_revenue) * 100) / 100,
    );
  });

  it("saldo das contas no razão bate com a soma de baixas, transferências e saldos iniciais", async () => {
    const ledger = await db.query<{ total: string }>(
      `select coalesce(sum(amount), 0) as total from public.fin_postings where organization_id = $1 and bucket = 'cash'`,
      [roberta.organizationId],
    );
    const derived = await db.query<{ total: string }>(
      `select
         (select coalesce(sum(case when e.kind = 'income' then s.amount else -s.amount end), 0)
            from public.fin_settlements s join public.fin_entries e on e.id = s.entry_id
           where s.organization_id = $1 and s.reversed_at is null)
       + (select coalesce(sum(case when adjustment_direction = 'increase' then amount else -amount end), 0)
            from public.fin_entries where organization_id = $1 and kind = 'adjustment' and cancelled_at is null)
       as total`,
      [roberta.organizationId],
    );
    expect(Number(ledger.rows[0].total)).toBe(Number(derived.rows[0].total));
  });
});
