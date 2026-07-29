/**
 * Testes de integração do banco: migrations, regras financeiras em SQL,
 * fechamento mensal, exclusão lógica, auditoria e Row Level Security.
 *
 * Rodam em Postgres real (PGlite/WASM), sem depender de um projeto Supabase.
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

const saleEntry = (brokerId: string, extra: Record<string, unknown> = {}) => ({
  entry_type: "sale",
  entry_date: "2026-03-10",
  description: "Venda Apartamento Centro",
  reference: "VD-2026-001",
  property_type: "residential",
  base_amount: 500000,
  commission_mode: "percentage",
  commission_rate: 6,
  splits: [{ broker_id: brokerId, split_mode: "percentage", split_rate: 40 }],
  ...extra,
});

async function saveEntry(userId: string, payload: unknown, entryId?: string) {
  return asUser(db, userId, async () => {
    const result = await db.query<{ app_save_entry: string }>(
      `select public.app_save_entry($1::jsonb, $2::uuid) as app_save_entry`,
      [JSON.stringify(payload), entryId ?? null],
    );
    return result.rows[0].app_save_entry;
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  roberta = await seedOrganization(db, "Roberta Oliveira Imóveis");
  outra = await seedOrganization(db, "Outra Imobiliária");
});

afterAll(async () => {
  await db?.close();
});

describe("migrations", () => {
  it("cria todas as tabelas, views e funções esperadas", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    const names = tables.rows.map((row) => row.table_name);

    for (const expected of [
      "organizations",
      "profiles",
      "organization_members",
      "brokers",
      "financial_entries",
      "entry_broker_splits",
      "organization_settings",
      "monthly_closings",
      "entry_imports",
      "audit_logs",
      "financial_entry_totals",
      "monthly_financial_summary",
      "entry_split_amounts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("habilita RLS em todas as tabelas expostas", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );

    for (const row of result.rows) {
      expect(row.relrowsecurity, `RLS desabilitada em ${row.relname}`).toBe(true);
    }
  });

  it("usa security_invoker nas views (RLS não é contornada)", async () => {
    const result = await db.query<{ viewname: string; options: string[] | null }>(
      `select c.relname as viewname, c.reloptions as options
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'`,
    );

    for (const row of result.rows) {
      expect(row.options?.join(","), `view ${row.viewname}`).toContain("security_invoker=true");
    }
  });

  it("guarda dinheiro em numeric, nunca em ponto flutuante", async () => {
    const result = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public'
         and (column_name like '%amount%' or column_name like '%rate%')`,
    );

    for (const row of result.rows) {
      expect(row.data_type, row.column_name).toBe("numeric");
    }
  });
});

describe("app_save_entry", () => {
  it("calcula comissão bruta, repasses e receita líquida", async () => {
    const entryId = await saveEntry(roberta.ownerId, saleEntry(roberta.brokerIds[0]));

    const totals = await asUser(db, roberta.ownerId, () =>
      db.query<{
        gross_commission: string;
        total_broker_payout: string;
        net_company_revenue: string;
        net_margin: string;
        broker_count: number;
      }>(`select * from public.financial_entry_totals where entry_id = $1`, [entryId]),
    );

    expect(totals.rows[0].gross_commission).toBe("30000.00");
    expect(totals.rows[0].total_broker_payout).toBe("12000.00");
    expect(totals.rows[0].net_company_revenue).toBe("18000.00");
    expect(Number(totals.rows[0].net_margin)).toBe(60);
    expect(totals.rows[0].broker_count).toBe(1);
  });

  it("aceita dois corretores e mantém a soma correta", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], {
        reference: "VD-2026-002",
        splits: [
          { broker_id: roberta.brokerIds[0], split_mode: "percentage", split_rate: 40 },
          { broker_id: roberta.brokerIds[1], split_mode: "percentage", split_rate: 15 },
        ],
      }),
    );

    const totals = await asUser(db, roberta.ownerId, () =>
      db.query<{ total_broker_payout: string; net_company_revenue: string }>(
        `select * from public.financial_entry_totals where entry_id = $1`,
        [entryId],
      ),
    );

    expect(totals.rows[0].total_broker_payout).toBe("16500.00");
    expect(totals.rows[0].net_company_revenue).toBe("13500.00");
  });

  it("bloqueia o mesmo corretor duas vezes no lançamento", async () => {
    const message = await expectError(
      saveEntry(
        roberta.ownerId,
        saleEntry(roberta.brokerIds[0], {
          splits: [
            { broker_id: roberta.brokerIds[0], split_mode: "percentage", split_rate: 40 },
            { broker_id: roberta.brokerIds[0], split_mode: "percentage", split_rate: 10 },
          ],
        }),
      ),
    );

    expect(message).toContain("já foi adicionado");
  });

  it("bloqueia receita líquida negativa sem exceção confirmada", async () => {
    const message = await expectError(
      saveEntry(
        roberta.ownerId,
        saleEntry(roberta.brokerIds[0], {
          splits: [{ broker_id: roberta.brokerIds[0], split_mode: "fixed", split_fixed_amount: 40000 }],
        }),
      ),
    );

    expect(message).toContain("maior que a comissão bruta");
  });

  it("exige justificativa de 10 caracteres na exceção financeira", async () => {
    const message = await expectError(
      saveEntry(
        roberta.ownerId,
        saleEntry(roberta.brokerIds[0], {
          exception_confirmed: true,
          exception_reason: "curta",
          splits: [{ broker_id: roberta.brokerIds[0], split_mode: "fixed", split_fixed_amount: 40000 }],
        }),
      ),
    );

    expect(message).toContain("pelo menos 10 caracteres");
  });

  it("registra a exceção confirmada na auditoria", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], {
        reference: "VD-2026-EXC",
        exception_confirmed: true,
        exception_reason: "Acordo comercial aprovado pela diretoria",
        splits: [{ broker_id: roberta.brokerIds[0], split_mode: "fixed", split_fixed_amount: 40000 }],
      }),
    );

    const totals = await asUser(db, roberta.ownerId, () =>
      db.query<{ net_company_revenue: string }>(
        `select net_company_revenue from public.financial_entry_totals where entry_id = $1`,
        [entryId],
      ),
    );
    expect(Number(totals.rows[0].net_company_revenue)).toBe(-10000);

    const audit = await db.query<{ action: string; metadata: Record<string, string> }>(
      `select action, metadata from public.audit_logs
       where entity_id = $1 and action = 'financial_exception_confirmed'`,
      [entryId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.justificativa).toContain("diretoria");
  });

  it("substitui os repasses ao editar o lançamento", async () => {
    const entryId = await saveEntry(roberta.ownerId, saleEntry(roberta.brokerIds[0], { reference: "VD-EDIT" }));

    await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[1], {
        reference: "VD-EDIT",
        splits: [{ broker_id: roberta.brokerIds[1], split_mode: "percentage", split_rate: 50 }],
      }),
      entryId,
    );

    const splits = await asUser(db, roberta.ownerId, () =>
      db.query<{ broker_id: string; payout_amount: string }>(
        `select broker_id, payout_amount from public.entry_split_amounts
         where entry_id = $1 and deleted_at is null`,
        [entryId],
      ),
    );

    expect(splits.rows).toHaveLength(1);
    expect(splits.rows[0].broker_id).toBe(roberta.brokerIds[1]);
    expect(splits.rows[0].payout_amount).toBe("15000.00");
  });

  it("recusa corretor de outra organização", async () => {
    const message = await expectError(
      saveEntry(roberta.ownerId, saleEntry(outra.brokerIds[0], { reference: "VD-CROSS" })),
    );
    expect(message).toContain("não encontrado");
  });
});

describe("padrões não retroativos", () => {
  it("mantém a taxa antiga após alterar a configuração padrão", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], { reference: "VD-DEFAULTS", entry_date: "2026-05-04" }),
    );

    await asUser(db, roberta.ownerId, () =>
      db.query(
        `update public.organization_settings set default_sale_commission_rate = 5
         where organization_id = $1`,
        [roberta.organizationId],
      ),
    );

    const entry = await asUser(db, roberta.ownerId, () =>
      db.query<{ commission_rate: string; gross_commission: string }>(
        `select commission_rate, gross_commission from public.financial_entry_totals where entry_id = $1`,
        [entryId],
      ),
    );

    expect(Number(entry.rows[0].commission_rate)).toBe(6);
    expect(entry.rows[0].gross_commission).toBe("30000.00");

    const settings = await asUser(db, roberta.ownerId, () =>
      db.query<{ default_sale_commission_rate: string }>(
        `select default_sale_commission_rate from public.organization_settings
         where organization_id = $1`,
        [roberta.organizationId],
      ),
    );
    expect(Number(settings.rows[0].default_sale_commission_rate)).toBe(5);
  });
});

describe("fechamento mensal", () => {
  it("bloqueia lançamentos em mês fechado e libera após reabertura", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], { entry_date: "2025-09-15", reference: "VD-CLOSE" }),
    );

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_close_month(2025, 9)`),
    );

    const blocked = await expectError(
      saveEntry(
        roberta.ownerId,
        saleEntry(roberta.brokerIds[0], { entry_date: "2025-09-20", reference: "VD-CLOSE-2" }),
      ),
    );
    expect(blocked).toContain("Este mês financeiro está fechado");

    const blockedDelete = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`select public.app_delete_entry($1::uuid, null)`, [entryId]),
      ),
    );
    expect(blockedDelete).toContain("fechado");

    const shortReason = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`select public.app_reopen_month(2025, 9, 'curto')`),
      ),
    );
    expect(shortReason).toContain("pelo menos 10 caracteres");

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_reopen_month(2025, 9, 'Correção solicitada pela diretoria')`),
    );

    await expect(
      saveEntry(
        roberta.ownerId,
        saleEntry(roberta.brokerIds[0], { entry_date: "2025-09-20", reference: "VD-CLOSE-3" }),
      ),
    ).resolves.toBeTruthy();

    const closing = await asUser(db, roberta.ownerId, () =>
      db.query<{ status: string; reopen_reason: string }>(
        `select status, reopen_reason from public.monthly_closings
         where organization_id = $1 and year = 2025 and month = 9`,
        [roberta.organizationId],
      ),
    );
    expect(closing.rows[0].status).toBe("open");
    expect(closing.rows[0].reopen_reason).toContain("diretoria");
  });
});

describe("exclusão lógica", () => {
  it("remove dos totais, mantém na lixeira e restaura", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], { entry_date: "2026-06-08", reference: "VD-TRASH" }),
    );

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_delete_entry($1::uuid, 'Lançamento duplicado')`, [entryId]),
    );

    const active = await asUser(db, roberta.ownerId, () =>
      db.query(`select * from public.report_entries('2026-06-01', '2026-06-30')`),
    );
    expect(active.rows.some((row) => (row as { entry_id: string }).entry_id === entryId)).toBe(false);

    const trash = await asUser(db, roberta.ownerId, () =>
      db.query(
        `select * from public.report_entries(null, null, null, null, null, null, null, true)`,
      ),
    );
    expect(trash.rows.some((row) => (row as { entry_id: string }).entry_id === entryId)).toBe(true);

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_restore_entry($1::uuid)`, [entryId]),
    );

    const restored = await asUser(db, roberta.ownerId, () =>
      db.query(`select * from public.report_entries('2026-06-01', '2026-06-30')`),
    );
    expect(restored.rows.some((row) => (row as { entry_id: string }).entry_id === entryId)).toBe(true);
  });
});

describe("auditoria", () => {
  it("registra criação, edição e exclusão e é imutável", async () => {
    const entryId = await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], { entry_date: "2026-02-11", reference: "VD-AUDIT" }),
    );
    await saveEntry(
      roberta.ownerId,
      saleEntry(roberta.brokerIds[0], {
        entry_date: "2026-02-11",
        reference: "VD-AUDIT",
        description: "Venda Apartamento Centro (corrigida)",
      }),
      entryId,
    );
    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_delete_entry($1::uuid, 'Cancelada')`, [entryId]),
    );

    const logs = await db.query<{ action: string; user_id: string }>(
      `select action, user_id from public.audit_logs
       where entity_type = 'financial_entries' and entity_id = $1 order by id`,
      [entryId],
    );

    expect(logs.rows.map((row) => row.action)).toEqual(["create", "update", "delete"]);
    expect(logs.rows[0].user_id).toBe(roberta.ownerId);

    const immutable = await expectError(
      db.query(`update public.audit_logs set action = 'hack' where entity_id = $1`, [entryId]),
    );
    expect(immutable).toContain("não podem ser alterados");
  });

  it("não permite que a aplicação escreva na auditoria", async () => {
    const message = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(
          `insert into public.audit_logs (organization_id, action, entity_type)
           values ($1, 'create', 'fake')`,
          [roberta.organizationId],
        ),
      ),
    );
    expect(message.toLowerCase()).toMatch(/permission denied|policy/);
  });
});

describe("row level security", () => {
  it("isola organizações diferentes", async () => {
    await saveEntry(
      outra.ownerId,
      saleEntry(outra.brokerIds[0], { reference: "OUTRA-1", entry_date: "2026-03-12" }),
    );

    const visible = await asUser(db, outra.ownerId, () =>
      db.query<{ organization_id: string }>(`select organization_id from public.financial_entries`),
    );

    expect(visible.rows.length).toBeGreaterThan(0);
    for (const row of visible.rows) {
      expect(row.organization_id).toBe(outra.organizationId);
    }
  });

  it("usuário inativo perde acesso", async () => {
    await db.query(`update public.profiles set is_active = false where id = $1`, [roberta.adminId]);

    const rows = await asUser(db, roberta.adminId, () =>
      db.query(`select * from public.financial_entries`),
    );
    expect(rows.rows).toHaveLength(0);

    const message = await expectError(
      saveEntry(roberta.adminId, saleEntry(roberta.brokerIds[0], { reference: "VD-INATIVO" })),
    );
    expect(message).toContain("organização ativa");

    await db.query(`update public.profiles set is_active = true where id = $1`, [roberta.adminId]);
  });

  it("membro desativado na organização perde acesso", async () => {
    await db.query(
      `update public.organization_members set status = 'inactive' where user_id = $1`,
      [roberta.adminId],
    );

    const rows = await asUser(db, roberta.adminId, () =>
      db.query(`select * from public.financial_entries`),
    );
    expect(rows.rows).toHaveLength(0);

    await db.query(
      `update public.organization_members set status = 'active' where user_id = $1`,
      [roberta.adminId],
    );
  });

  it("somente o proprietário altera configurações e membros", async () => {
    const settings = await asUser(db, roberta.adminId, () =>
      db.query(
        `update public.organization_settings set default_broker_split_rate = 33
         where organization_id = $1 returning id`,
        [roberta.organizationId],
      ),
    );
    expect(settings.rows).toHaveLength(0);

    const asOwner = await asUser(db, roberta.ownerId, () =>
      db.query(
        `update public.organization_settings set default_broker_split_rate = 33
         where organization_id = $1 returning id`,
        [roberta.organizationId],
      ),
    );
    expect(asOwner.rows).toHaveLength(1);
  });

  it("não permite exclusão física de lançamentos pela aplicação", async () => {
    const message = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`delete from public.financial_entries where organization_id = $1`, [
          roberta.organizationId,
        ]),
      ),
    );
    expect(message.toLowerCase()).toMatch(/permission denied|policy/);
  });
});

describe("importação", () => {
  it("importa em bloco e permite desfazer", async () => {
    const payload = {
      source_filename: "CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx",
      entries: [
        saleEntry(roberta.brokerIds[0], { entry_date: "2026-01-15", reference: "IMP-1" }),
        saleEntry(roberta.brokerIds[1], { entry_date: "2026-01-20", reference: "IMP-2" }),
      ],
    };

    const result = await asUser(db, roberta.ownerId, () =>
      db.query<{ app_import_entries: { import_id: string; entries_count: number } }>(
        `select public.app_import_entries($1::jsonb) as app_import_entries`,
        [JSON.stringify(payload)],
      ),
    );

    const { import_id: importId, entries_count: count } = result.rows[0].app_import_entries;
    expect(count).toBe(2);

    const undone = await asUser(db, roberta.ownerId, () =>
      db.query<{ app_undo_import: number }>(
        `select public.app_undo_import($1::uuid) as app_undo_import`,
        [importId],
      ),
    );
    expect(undone.rows[0].app_undo_import).toBe(2);

    const remaining = await asUser(db, roberta.ownerId, () =>
      db.query(
        `select * from public.financial_entries where import_id = $1 and deleted_at is null`,
        [importId],
      ),
    );
    expect(remaining.rows).toHaveLength(0);
  });
});
