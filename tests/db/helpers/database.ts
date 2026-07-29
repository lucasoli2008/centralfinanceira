/**
 * Banco Postgres em memória (PGlite) para validar migrations, RLS e a paridade
 * entre o motor financeiro em TypeScript e o motor financeiro em SQL.
 *
 * O schema `auth` do Supabase é simulado com o mínimo necessário:
 * a tabela auth.users e a função auth.uid(), que aqui lê uma variável de sessão.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export type TestDatabase = PGlite;

const AUTH_STUB = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end
  $$;

  grant usage on schema public, auth to anon, authenticated;
  grant select on auth.users to authenticated;
`;

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });

  await db.exec(AUTH_STUB);

  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Falha ao aplicar ${file}: ${(error as Error).message}`);
    }
  }

  return db;
}

/** Executa um bloco como um usuário autenticado específico (RLS ativa). */
export async function asUser<T>(
  db: TestDatabase,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role authenticated; select set_config('app.user_id', '${userId}', false);`);
  try {
    return await run();
  } finally {
    await db.exec(`reset role; select set_config('app.user_id', '', false);`);
  }
}

export interface SeededOrganization {
  organizationId: string;
  ownerId: string;
  adminId: string;
  brokerIds: string[];
}

/** Cria organização, configurações, um proprietário, um admin e três corretores. */
export async function seedOrganization(
  db: TestDatabase,
  name: string,
  { brokerNames = ["Corretor Um", "Corretor Dois", "Corretor Três"] }: { brokerNames?: string[] } = {},
): Promise<SeededOrganization> {
  const org = await db.query<{ id: string }>(
    `insert into public.organizations (name) values ($1) returning id`,
    [name],
  );
  const organizationId = org.rows[0].id;

  await db.query(`insert into public.organization_settings (organization_id) values ($1)`, [
    organizationId,
  ]);

  const users: string[] = [];
  for (const role of ["owner", "admin"] as const) {
    const user = await db.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [`${role}.${organizationId}@exemplo.com.br`],
    );
    const userId = user.rows[0].id;
    users.push(userId);
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3)`,
      [organizationId, userId, role],
    );
  }

  const brokerIds: string[] = [];
  for (const brokerName of brokerNames) {
    const broker = await db.query<{ id: string }>(
      `insert into public.brokers (organization_id, full_name, default_split_rate)
       values ($1, $2, 40) returning id`,
      [organizationId, brokerName],
    );
    brokerIds.push(broker.rows[0].id);
  }

  return { organizationId, ownerId: users[0], adminId: users[1], brokerIds };
}

export async function expectError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Esperava um erro, mas a operação foi concluída com sucesso.");
}
