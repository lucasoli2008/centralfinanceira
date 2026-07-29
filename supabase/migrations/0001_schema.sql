-- =============================================================================
-- Central Financeira — 0001 · Estrutura base
-- Organizações, perfis, membros, corretores, lançamentos, repasses,
-- configurações, fechamentos mensais, importações e auditoria.
--
-- Dinheiro:      numeric(18,2)   (nunca float/double precision)
-- Percentuais:   numeric(9,6)    armazenados em pontos percentuais (6% => 6.000000)
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'entry_type') then
    create type public.entry_type as enum ('sale', 'rental');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_type') then
    create type public.property_type as enum ('residential', 'commercial');
  end if;
  if not exists (select 1 from pg_type where typname = 'amount_mode') then
    create type public.amount_mode as enum ('percentage', 'fixed');
  end if;
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type public.member_role as enum ('owner', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type public.member_status as enum ('active', 'inactive');
  end if;
  if not exists (select 1 from pg_type where typname = 'closing_status') then
    create type public.closing_status as enum ('open', 'closed');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Organizações
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  legal_name      text,
  document_number text,
  logo_url        text,
  accent_color    text not null default '#0F5132'
                    check (accent_color ~* '^#[0-9a-f]{6}$'),
  timezone        text not null default 'America/Sao_Paulo',
  currency        text not null default 'BRL',
  locale          text not null default 'pt-BR',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  avatar_url text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Membros da organização
-- -----------------------------------------------------------------------------
create table if not exists public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.member_role not null default 'admin',
  status          public.member_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Corretores (registros de cálculo — não possuem login)
-- -----------------------------------------------------------------------------
create table if not exists public.brokers (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete cascade,
  full_name                  text not null check (length(btrim(full_name)) > 0),
  short_name                 text,
  email                      text,
  phone                      text,
  document_number            text, -- CRECI
  default_split_mode         public.amount_mode not null default 'percentage',
  default_split_rate         numeric(9, 6) check (default_split_rate is null
                               or (default_split_rate >= 0 and default_split_rate <= 100)),
  default_split_fixed_amount numeric(18, 2) check (default_split_fixed_amount is null
                               or default_split_fixed_amount >= 0),
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid references public.profiles (id),
  updated_by                 uuid references public.profiles (id)
);

-- Nome normalizado, usado para detectar duplicidade entre corretores ativos.
create or replace function public.normalized_name(p_name text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- -----------------------------------------------------------------------------
-- Importações da planilha (permitem desfazer em bloco)
-- -----------------------------------------------------------------------------
create table if not exists public.entry_imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_filename text,
  entries_count   integer not null default 0,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid references public.profiles (id)
);

-- -----------------------------------------------------------------------------
-- Lançamentos financeiros (base única — sem tabelas por mês)
-- -----------------------------------------------------------------------------
create table if not exists public.financial_entries (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  entry_type              public.entry_type not null,
  entry_date              date not null,
  description             text not null check (length(btrim(description)) > 0),
  reference               text,
  property_type           public.property_type not null default 'residential',
  base_amount             numeric(18, 2) not null check (base_amount >= 0),
  commission_mode         public.amount_mode not null default 'percentage',
  commission_rate         numeric(9, 6) check (commission_rate is null
                            or (commission_rate >= 0 and commission_rate <= 100)),
  commission_fixed_amount numeric(18, 2) check (commission_fixed_amount is null
                            or commission_fixed_amount >= 0),
  notes                   text,
  exception_confirmed     boolean not null default false,
  exception_reason        text,
  import_id               uuid references public.entry_imports (id) on delete set null,
  created_by              uuid references public.profiles (id),
  updated_by              uuid references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  deleted_by              uuid references public.profiles (id),
  deletion_reason         text,
  entry_year              integer generated always as (extract(year from entry_date)::integer) stored,
  entry_month             integer generated always as (extract(month from entry_date)::integer) stored,
  constraint financial_entries_commission_input_ck check (
    (commission_mode = 'percentage' and commission_rate is not null)
    or (commission_mode = 'fixed' and commission_fixed_amount is not null)
  ),
  constraint financial_entries_exception_reason_ck check (
    exception_confirmed = false
    or (exception_reason is not null and length(btrim(exception_reason)) >= 10)
  )
);

-- -----------------------------------------------------------------------------
-- Repasses aos corretores (1 lançamento : N repasses)
-- -----------------------------------------------------------------------------
create table if not exists public.entry_broker_splits (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  entry_id           uuid not null references public.financial_entries (id) on delete cascade,
  broker_id          uuid not null references public.brokers (id),
  split_mode         public.amount_mode not null default 'percentage',
  split_rate         numeric(9, 6) check (split_rate is null
                       or (split_rate >= 0 and split_rate <= 100)),
  split_fixed_amount numeric(18, 2) check (split_fixed_amount is null
                       or split_fixed_amount >= 0),
  created_by         uuid references public.profiles (id),
  updated_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint entry_broker_splits_input_ck check (
    (split_mode = 'percentage' and split_rate is not null)
    or (split_mode = 'fixed' and split_fixed_amount is not null)
  )
);

-- Um mesmo corretor não pode ser adicionado duas vezes ao mesmo lançamento.
create unique index if not exists entry_broker_splits_unique_broker_idx
  on public.entry_broker_splits (entry_id, broker_id)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Configurações financeiras e de relatórios (1 linha por organização)
-- -----------------------------------------------------------------------------
create table if not exists public.organization_settings (
  id                                    uuid primary key default gen_random_uuid(),
  organization_id                       uuid not null unique
                                          references public.organizations (id) on delete cascade,
  default_sale_commission_mode          public.amount_mode not null default 'percentage',
  default_sale_commission_rate          numeric(9, 6) not null default 6
                                          check (default_sale_commission_rate >= 0
                                                 and default_sale_commission_rate <= 100),
  default_sale_commission_fixed_amount  numeric(18, 2) check (default_sale_commission_fixed_amount is null
                                          or default_sale_commission_fixed_amount >= 0),
  default_rental_commission_mode        public.amount_mode not null default 'percentage',
  default_rental_commission_rate        numeric(9, 6) not null default 100
                                          check (default_rental_commission_rate >= 0
                                                 and default_rental_commission_rate <= 100),
  default_rental_commission_fixed_amount numeric(18, 2) check (default_rental_commission_fixed_amount is null
                                          or default_rental_commission_fixed_amount >= 0),
  default_broker_split_rate             numeric(9, 6) not null default 40
                                          check (default_broker_split_rate >= 0
                                                 and default_broker_split_rate <= 100),
  monthly_closing_enabled               boolean not null default true,
  report_header                         text,
  report_footer                         text,
  created_at                            timestamptz not null default now(),
  updated_at                            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Fechamento mensal
-- -----------------------------------------------------------------------------
create table if not exists public.monthly_closings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year            integer not null check (year between 2000 and 2200),
  month           integer not null check (month between 1 and 12),
  status          public.closing_status not null default 'open',
  closed_by       uuid references public.profiles (id),
  closed_at       timestamptz,
  reopened_by     uuid references public.profiles (id),
  reopened_at     timestamptz,
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, year, month)
);

-- -----------------------------------------------------------------------------
-- Auditoria (imutável para a aplicação — escrita apenas por triggers/definers)
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id              bigserial primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id         uuid references public.profiles (id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before_data     jsonb,
  after_data      jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'organization_members', 'brokers',
    'financial_entries', 'entry_broker_splits', 'organization_settings', 'monthly_closings'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;
