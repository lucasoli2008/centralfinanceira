/**
 * Testes de integração do módulo Obras: geração de código, RPCs de obra,
 * lançamentos de custo e RLS entre organizações.
 *
 * Rodam em Postgres real (PGlite/WASM), sem depender de um projeto Supabase.
 * Políticas de `storage.objects` não são testáveis aqui (PGlite não tem o
 * schema `storage`) — ver docs/SECURITY.md para a checagem manual.
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

const baseWork = (extra: Record<string, unknown> = {}) => ({
  title: "Reforma banheiro social",
  property_label: "Apto 302 — Edifício Aurora",
  address: "Rua das Palmeiras, 123",
  owner_label: "Maria Souza",
  responsible_name: "João Corretor",
  description: "Troca de revestimento e louças do banheiro social.",
  status: "planejada",
  category: "reforma",
  priority: "normal",
  ...extra,
});

async function saveWork(userId: string, payload: unknown, workId?: string) {
  return asUser(db, userId, async () => {
    const result = await db.query<{ app_save_work: string }>(
      `select public.app_save_work($1::jsonb, $2::uuid) as app_save_work`,
      [JSON.stringify(payload), workId ?? null],
    );
    return result.rows[0].app_save_work;
  });
}

async function saveWorkEntry(userId: string, payload: unknown, entryId?: string) {
  return asUser(db, userId, async () => {
    const result = await db.query<{ app_save_work_entry: string }>(
      `select public.app_save_work_entry($1::jsonb, $2::uuid) as app_save_work_entry`,
      [JSON.stringify(payload), entryId ?? null],
    );
    return result.rows[0].app_save_work_entry;
  });
}

async function generateCode(userId: string, organizationId: string) {
  return asUser(db, userId, async () => {
    const result = await db.query<{ app_generate_work_code: string }>(
      `select public.app_generate_work_code($1::uuid) as app_generate_work_code`,
      [organizationId],
    );
    return result.rows[0].app_generate_work_code;
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

describe("app_generate_work_code", () => {
  it("gera códigos sequenciais e únicos por organização e ano", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push(await generateCode(roberta.ownerId, roberta.organizationId));
    }

    expect(new Set(codes).size).toBe(5);
    const year = new Date().getFullYear();
    expect(codes[0]).toBe(`OBR-${year}-0001`);
    expect(codes[4]).toBe(`OBR-${year}-0005`);
  });

  it("mantém contadores independentes entre organizações", async () => {
    const code = await generateCode(outra.ownerId, outra.organizationId);
    const year = new Date().getFullYear();
    expect(code).toBe(`OBR-${year}-0001`);
  });
});

describe("app_save_work", () => {
  it("exige todos os campos obrigatórios", async () => {
    const message = await expectError(saveWork(roberta.ownerId, baseWork({ title: "" })));
    expect(message).toContain("Informe o título da obra.");
  });

  it("cria a obra, gera o código e registra a atividade de criação", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork({ reference: "OBRA-1" }));

    const work = await asUser(db, roberta.ownerId, () =>
      db.query<{ code: string; status: string; is_archived: boolean }>(
        `select code, status, is_archived from public.works where id = $1`,
        [workId],
      ),
    );
    expect(work.rows[0].code).toMatch(/^OBR-\d{4}-\d{4}$/);
    expect(work.rows[0].status).toBe("planejada");
    expect(work.rows[0].is_archived).toBe(false);

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual(["obra_criada"]);
  });

  it("bloqueia conclusão anterior ao início (works_dates_ck)", async () => {
    const message = await expectError(
      saveWork(
        roberta.ownerId,
        baseWork({ started_at: "2026-03-10", completed_at: "2026-03-01" }),
      ),
    );
    expect(message).toContain("works_dates_ck");
  });

  it("registra status_alterado e obra_concluida ao editar", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    await saveWork(roberta.ownerId, baseWork({ status: "em_andamento" }), workId);
    await saveWork(roberta.ownerId, baseWork({ status: "concluida" }), workId);

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual([
      "obra_criada",
      "status_alterado",
      "status_alterado",
      "obra_concluida",
    ]);
  });

  it("recusa editar obra de outra organização", async () => {
    const workId = await saveWork(outra.ownerId, baseWork());

    const message = await expectError(saveWork(roberta.ownerId, baseWork(), workId));
    expect(message).toContain("Obra não encontrada");
  });
});

describe("app_archive_work / app_unarchive_work", () => {
  it("arquiva, bloqueia arquivar de novo e permite reabrir", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_archive_work($1::uuid, $2)`, [workId, "Obra cancelada"]),
    );

    const archived = await asUser(db, roberta.ownerId, () =>
      db.query<{ is_archived: boolean; archived_reason: string }>(
        `select is_archived, archived_reason from public.works where id = $1`,
        [workId],
      ),
    );
    expect(archived.rows[0].is_archived).toBe(true);
    expect(archived.rows[0].archived_reason).toBe("Obra cancelada");

    const doubleArchive = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`select public.app_archive_work($1::uuid)`, [workId]),
      ),
    );
    expect(doubleArchive).toContain("já arquivada");

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_unarchive_work($1::uuid)`, [workId]),
    );

    const reopened = await asUser(db, roberta.ownerId, () =>
      db.query<{ is_archived: boolean }>(`select is_archived from public.works where id = $1`, [
        workId,
      ]),
    );
    expect(reopened.rows[0].is_archived).toBe(false);

    const doubleUnarchive = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`select public.app_unarchive_work($1::uuid)`, [workId]),
      ),
    );
    expect(doubleUnarchive).toContain("não encontrada na lista de arquivadas");
  });
});

describe("app_save_work_entry", () => {
  it("calcula o total automaticamente a partir de quantidade × valor unitário", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    const entryId = await saveWorkEntry(roberta.ownerId, {
      work_id: workId,
      entry_type: "material",
      entry_date: "2026-03-05",
      description: "Porcelanato 60x60",
      quantity: 12.5,
      unit: "m2",
      unit_price: 79.9,
      total_is_manual: false,
    });

    const entry = await asUser(db, roberta.ownerId, () =>
      db.query<{ total_amount: string }>(
        `select total_amount from public.work_entries where id = $1`,
        [entryId],
      ),
    );
    expect(entry.rows[0].total_amount).toBe("998.75");
  });

  it("usa o valor manual quando total_is_manual é verdadeiro", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    const entryId = await saveWorkEntry(roberta.ownerId, {
      work_id: workId,
      entry_type: "servico",
      entry_date: "2026-03-06",
      description: "Mão de obra hidráulica",
      quantity: 1,
      unit: "servico",
      unit_price: 500,
      total_amount: 450,
      total_is_manual: true,
    });

    const entry = await asUser(db, roberta.ownerId, () =>
      db.query<{ total_amount: string; total_is_manual: boolean }>(
        `select total_amount, total_is_manual from public.work_entries where id = $1`,
        [entryId],
      ),
    );
    expect(entry.rows[0].total_amount).toBe("450.00");
    expect(entry.rows[0].total_is_manual).toBe(true);
  });

  it("remove o item (soft delete) e registra a atividade", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    const entryId = await saveWorkEntry(roberta.ownerId, {
      work_id: workId,
      entry_type: "outro_custo",
      entry_date: "2026-03-07",
      description: "Taxa de descarte de entulho",
      quantity: 1,
      unit: "servico",
      unit_price: 120,
      total_is_manual: false,
    });

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_delete_work_entry($1::uuid)`, [entryId]),
    );

    const remaining = await asUser(db, roberta.ownerId, () =>
      db.query(`select 1 from public.work_entries where id = $1 and deleted_at is null`, [
        entryId,
      ]),
    );
    expect(remaining.rows).toHaveLength(0);

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual(["obra_criada", "item_adicionado", "item_removido"]);
  });
});

describe("pagamento dos itens (0009)", () => {
  const entryPayload = (workId: string, extra: Record<string, unknown> = {}) => ({
    work_id: workId,
    entry_type: "servico",
    entry_date: "2026-04-01",
    description: "Pintura da sala",
    quantity: 1,
    unit: "servico",
    unit_price: 1200,
    total_is_manual: false,
    ...extra,
  });

  it("item pago sem data recebe a data de hoje; não pago zera a data", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    const entryId = await saveWorkEntry(roberta.ownerId, entryPayload(workId, { is_paid: true }));

    const paid = await asUser(db, roberta.ownerId, () =>
      db.query<{ is_paid: boolean; paid_at: string | null }>(
        `select is_paid, paid_at::text from public.work_entries where id = $1`,
        [entryId],
      ),
    );
    expect(paid.rows[0].is_paid).toBe(true);
    expect(paid.rows[0].paid_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await saveWorkEntry(roberta.ownerId, entryPayload(workId, { is_paid: false, paid_at: "2026-04-02" }), entryId);
    const unpaid = await asUser(db, roberta.ownerId, () =>
      db.query<{ is_paid: boolean; paid_at: string | null }>(
        `select is_paid, paid_at::text from public.work_entries where id = $1`,
        [entryId],
      ),
    );
    expect(unpaid.rows[0]).toEqual({ is_paid: false, paid_at: null });
  });

  it("a constraint impede pago sem data por escrita direta", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    const entryId = await saveWorkEntry(roberta.ownerId, entryPayload(workId));

    const message = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`update public.work_entries set is_paid = true, paid_at = null where id = $1`, [entryId]),
      ),
    );
    expect(message).toContain("work_entries_paid_ck");
  });

  it("app_set_work_entry_paid marca, registra item_pago e desmarca", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    const entryId = await saveWorkEntry(roberta.ownerId, entryPayload(workId));

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_set_work_entry_paid($1::uuid, true, '2026-04-10'::date)`, [entryId]),
    );
    const paid = await asUser(db, roberta.ownerId, () =>
      db.query<{ is_paid: boolean; paid_at: string }>(
        `select is_paid, paid_at::text from public.work_entries where id = $1`,
        [entryId],
      ),
    );
    expect(paid.rows[0]).toEqual({ is_paid: true, paid_at: "2026-04-10" });

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_set_work_entry_paid($1::uuid, false)`, [entryId]),
    );

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string; description: string }>(
        `select action, description from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual([
      "obra_criada",
      "item_adicionado",
      "item_pago",
      "item_editado",
    ]);
    expect(activities.rows[2].description).toContain("R$ 1200,00");
  });

  it("editar um item registra item_editado e só loga item_pago na transição", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    const entryId = await saveWorkEntry(roberta.ownerId, entryPayload(workId));

    await saveWorkEntry(roberta.ownerId, entryPayload(workId, { description: "Pintura completa" }), entryId);
    await saveWorkEntry(roberta.ownerId, entryPayload(workId, { is_paid: true }), entryId);
    await saveWorkEntry(roberta.ownerId, entryPayload(workId, { is_paid: true, unit_price: 1300 }), entryId);

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual([
      "obra_criada",
      "item_adicionado",
      "item_editado",
      "item_editado",
      "item_pago",
      "item_editado",
    ]);
  });
});

describe("app_update_work_status", () => {
  it("troca o status, preenche a conclusão e registra as atividades", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork({ status: "em_andamento" }));

    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_update_work_status($1::uuid, 'concluida')`, [workId]),
    );

    const work = await asUser(db, roberta.ownerId, () =>
      db.query<{ status: string; completed_at: string | null }>(
        `select status, completed_at::text from public.works where id = $1`,
        [workId],
      ),
    );
    expect(work.rows[0].status).toBe("concluida");
    expect(work.rows[0].completed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Mesmo status de novo: sem atividade duplicada.
    await asUser(db, roberta.ownerId, () =>
      db.query(`select public.app_update_work_status($1::uuid, 'concluida')`, [workId]),
    );

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual([
      "obra_criada",
      "status_alterado",
      "obra_concluida",
    ]);
  });

  it("recusa obra arquivada ou de outra organização", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());
    await asUser(db, roberta.ownerId, () => db.query(`select public.app_archive_work($1::uuid)`, [workId]));

    const archived = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`select public.app_update_work_status($1::uuid, 'pausada')`, [workId]),
      ),
    );
    expect(archived).toContain("Obra não encontrada");

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual(["obra_criada", "obra_arquivada"]);

    await asUser(db, roberta.ownerId, () => db.query(`select public.app_unarchive_work($1::uuid)`, [workId]));
    const reopened = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string }>(
        `select action from public.work_activities where work_id = $1 order by created_at desc limit 1`,
        [workId],
      ),
    );
    expect(reopened.rows[0].action).toBe("obra_reaberta");

    const foreign = await expectError(
      asUser(db, outra.ownerId, () =>
        db.query(`select public.app_update_work_status($1::uuid, 'pausada')`, [workId]),
      ),
    );
    expect(foreign).toContain("Obra não encontrada");
  });
});

describe("anexos", () => {
  it("registra um anexo e devolve o storage_path ao remover", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    const attachmentId = await asUser(db, roberta.ownerId, async () => {
      const result = await db.query<{ app_register_work_attachment: string }>(
        `select public.app_register_work_attachment($1::jsonb) as app_register_work_attachment`,
        [
          JSON.stringify({
            work_id: workId,
            category: "nota_fiscal",
            storage_path: `${roberta.organizationId}/${workId}/nota.pdf`,
            file_name: "nota.pdf",
            mime_type: "application/pdf",
            file_size_bytes: 1024,
          }),
        ],
      );
      return result.rows[0].app_register_work_attachment;
    });

    const removed = await asUser(db, roberta.ownerId, async () => {
      const result = await db.query<{ app_delete_work_attachment: string }>(
        `select public.app_delete_work_attachment($1::uuid) as app_delete_work_attachment`,
        [attachmentId],
      );
      return result.rows[0].app_delete_work_attachment;
    });
    expect(removed).toBe(`${roberta.organizationId}/${workId}/nota.pdf`);

    const remaining = await asUser(db, roberta.ownerId, () =>
      db.query(`select 1 from public.work_attachments where id = $1 and deleted_at is null`, [
        attachmentId,
      ]),
    );
    expect(remaining.rows).toHaveLength(0);

    const activities = await asUser(db, roberta.ownerId, () =>
      db.query<{ action: string; description: string }>(
        `select action, description from public.work_activities where work_id = $1 order by created_at`,
        [workId],
      ),
    );
    expect(activities.rows.map((row) => row.action)).toEqual([
      "obra_criada",
      "documento_enviado",
      "anexo_removido",
    ]);
    expect(activities.rows[2].description).toContain("nota.pdf");
  });
});

describe("row level security", () => {
  it("isola obras entre organizações diferentes", async () => {
    await saveWork(outra.ownerId, baseWork({ title: "Obra da outra imobiliária" }));

    const visible = await asUser(db, outra.ownerId, () =>
      db.query<{ organization_id: string }>(`select organization_id from public.works`),
    );

    expect(visible.rows.length).toBeGreaterThan(0);
    for (const row of visible.rows) {
      expect(row.organization_id).toBe(outra.organizationId);
    }
  });

  it("não permite excluir obras fisicamente pela aplicação", async () => {
    const workId = await saveWork(roberta.ownerId, baseWork());

    const message = await expectError(
      asUser(db, roberta.ownerId, () =>
        db.query(`delete from public.works where id = $1`, [workId]),
      ),
    );
    expect(message.toLowerCase()).toMatch(/permission denied|policy/);
  });
});
