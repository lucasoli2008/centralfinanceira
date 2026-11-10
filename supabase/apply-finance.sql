-- Controle Financeiro: migrações 0010 a 0014 em um único arquivo.
-- Cole tudo no SQL Editor do Supabase e clique em Run. Pode ser colado de novo sem problema (é reaplicável).

-- ===================== 0010_finance_core.sql =====================
-- =============================================================================
-- Central Financeira — 0010 · Controle Financeiro (Fase 1: fundação)
--
-- Livro-razão gerencial com partidas balanceadas. Toda movimentação vira um
-- LOTE (fin_ledger_batches) de PARTIDAS (fin_postings) cuja soma é zero:
-- valor positivo = débito, negativo = crédito. As partidas são imutáveis;
-- correções e estornos criam um lote espelho (reverses_batch_id).
--
-- Baldes do razão (fin_postings.bucket):
--   cash         ativo   — saldo de cada conta financeira (account_id obrigatório)
--   receivable   ativo   — contas a receber
--   payable      passivo — contas a pagar
--   revenue      resultado (receita própria / outras receitas)
--   expense      resultado (deduções, custos, despesas)
--   third_party  passivo — dinheiro de terceiros ainda não programado para repasse
--   deposit      passivo — cauções e depósitos reembolsáveis
--   equity       patrimônio — aportes e retiradas de sócios
--   opening      patrimônio — saldos iniciais e ajustes de saldo justificados
--
-- Princípio inegociável: receita própria vem SOMENTE de categorias com
-- natureza own_revenue/other_revenue. Aluguel recebido para repasse, parcela
-- de corretores, cauções, transferências entre contas e aportes nunca viram
-- receita — ficam em third_party/deposit/equity/cash.
--
-- Escrita: somente pelas RPCs app_fin_* (que ligam o contexto app.fin_rpc).
-- As policies de INSERT/UPDATE exigem esse contexto, então nem um usuário com
-- permissão de escrita consegue gravar partidas ou baixas soltas via API.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Perfis de acesso financeiro
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_members' and column_name = 'finance_role'
  ) then
    alter table public.organization_members
      add column finance_role text not null default 'sem_acesso';

    -- Quem já gerenciava o financeiro de comissões continua com acesso:
    -- proprietário = administrador financeiro; administradores = financeiro.
    update public.organization_members set finance_role = 'admin' where role = 'owner';
    update public.organization_members set finance_role = 'financeiro' where role = 'admin';
  end if;
end
$$;

alter table public.organization_members drop constraint if exists organization_members_finance_role_ck;
alter table public.organization_members add constraint organization_members_finance_role_ck
  check (finance_role in ('admin', 'financeiro', 'gestor', 'consulta', 'sem_acesso'));

-- Perfil financeiro do usuário atual. O proprietário é sempre administrador.
create or replace function public.fin_current_role(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when m.role = 'owner' then 'admin' else m.finance_role end
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
    and p.is_active
  limit 1;
$$;

-- view   → consulta, gestor, financeiro, admin
-- write  → financeiro, admin (lançar, baixar, cadastrar, importar)
-- close  → gestor, financeiro, admin (fechamento — Fase 3)
-- admin  → admin (reabrir período, permissões)
create or replace function public.fin_can(p_organization_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case p_action
      when 'view'  then public.fin_current_role(p_organization_id) in ('admin', 'financeiro', 'gestor', 'consulta')
      when 'write' then public.fin_current_role(p_organization_id) in ('admin', 'financeiro')
      when 'close' then public.fin_current_role(p_organization_id) in ('admin', 'financeiro', 'gestor')
      when 'admin' then public.fin_current_role(p_organization_id) = 'admin'
      else false
    end,
    false
  );
$$;

create or replace function public.fin_require(p_action text)
returns uuid
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  if not public.fin_can(v_org, p_action) then
    raise exception 'Você não tem permissão para esta operação no Controle Financeiro.'
      using errcode = 'CF004';
  end if;
  -- Libera a escrita nas tabelas financeiras somente dentro desta transação.
  if p_action <> 'view' then
    perform set_config('app.fin_rpc', 'on', true);
  end if;
  return v_org;
end;
$$;

create or replace function public.fin_rpc_context()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.fin_rpc', true), '') = 'on';
$$;

-- "Hoje" no fuso da imobiliária (o banco roda em UTC).
create or replace function public.fin_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- -----------------------------------------------------------------------------
-- 2. Cadastros
-- -----------------------------------------------------------------------------
create table if not exists public.fin_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  kind            text not null default 'checking'
                    check (kind in ('checking', 'savings', 'cash', 'digital', 'investment')),
  bank_name       text,
  branch          text,
  account_number  text,
  opening_balance numeric(18, 2) not null default 0,
  opening_date    date not null default current_date,
  is_active       boolean not null default true,
  notes           text,
  created_by      uuid references public.profiles (id),
  updated_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists fin_accounts_org_name_uidx
  on public.fin_accounts (organization_id, lower(btrim(name)));

create table if not exists public.fin_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_id       uuid references public.fin_categories (id),
  name            text not null check (length(btrim(name)) > 0),
  nature          text not null check (nature in (
                    'own_revenue', 'other_revenue', 'deduction', 'direct_cost',
                    'operating_expense', 'other_expense', 'third_party', 'deposit', 'equity'
                  )),
  cost_behavior   text check (cost_behavior in ('fixed', 'variable')),
  system_key      text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_by      uuid references public.profiles (id),
  updated_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists fin_categories_org_name_uidx
  on public.fin_categories (
    organization_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );
create unique index if not exists fin_categories_org_system_key_uidx
  on public.fin_categories (organization_id, system_key) where system_key is not null;

create table if not exists public.fin_cost_centers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  is_active       boolean not null default true,
  created_by      uuid references public.profiles (id),
  updated_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists fin_cost_centers_org_name_uidx
  on public.fin_cost_centers (organization_id, lower(btrim(name)));

create table if not exists public.fin_counterparties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  kind            text not null default 'other' check (kind in (
                    'supplier', 'client', 'owner', 'tenant', 'broker', 'partner',
                    'government', 'bank', 'other'
                  )),
  document_number text,
  email           text,
  phone           text,
  broker_id       uuid references public.brokers (id),
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references public.profiles (id),
  updated_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists fin_counterparties_org_name_uidx
  on public.fin_counterparties (organization_id, public.normalized_name(name));
create unique index if not exists fin_counterparties_org_broker_uidx
  on public.fin_counterparties (organization_id, broker_id) where broker_id is not null;

create table if not exists public.fin_properties (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  label                 text not null check (length(btrim(label)) > 0),
  address               text,
  owner_counterparty_id uuid references public.fin_counterparties (id),
  admin_fee_rate        numeric(9, 6) check (admin_fee_rate is null or (admin_fee_rate >= 0 and admin_fee_rate <= 100)),
  is_active             boolean not null default true,
  notes                 text,
  created_by            uuid references public.profiles (id),
  updated_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists fin_properties_org_label_uidx
  on public.fin_properties (organization_id, lower(btrim(label)));

-- -----------------------------------------------------------------------------
-- 3. Operações imobiliárias (agrupam os lançamentos de um mesmo evento)
-- -----------------------------------------------------------------------------
create table if not exists public.fin_operations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  kind                text not null check (kind in ('rental_collection', 'commission_receipt')),
  description         text not null,
  property_id         uuid references public.fin_properties (id),
  counterparty_id     uuid references public.fin_counterparties (id),
  commission_entry_id uuid references public.financial_entries (id),
  reference_date      date not null,
  gross_amount        numeric(18, 2) not null check (gross_amount >= 0),
  own_amount          numeric(18, 2) not null check (own_amount >= 0),
  third_party_amount  numeric(18, 2) not null check (third_party_amount >= 0),
  notes               text,
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id),
  cancel_reason       text,
  created_by          uuid references public.profiles (id),
  updated_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fin_operations_split_ck check (own_amount + third_party_amount = gross_amount)
);
-- Uma comissão só pode ser lançada no caixa uma vez.
create unique index if not exists fin_operations_commission_uidx
  on public.fin_operations (organization_id, commission_entry_id)
  where commission_entry_id is not null and cancelled_at is null;

-- -----------------------------------------------------------------------------
-- 4. Lançamentos (títulos) e baixas
-- -----------------------------------------------------------------------------
create table if not exists public.fin_entries (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  kind                 text not null check (kind in ('income', 'expense', 'transfer', 'adjustment')),
  description          text not null check (length(btrim(description)) > 0),
  amount               numeric(18, 2) not null check (amount > 0),
  category_id          uuid references public.fin_categories (id),
  account_id           uuid references public.fin_accounts (id),
  transfer_account_id  uuid references public.fin_accounts (id),
  adjustment_direction text check (adjustment_direction in ('increase', 'decrease')),
  counterparty_id      uuid references public.fin_counterparties (id),
  cost_center_id       uuid references public.fin_cost_centers (id),
  property_id          uuid references public.fin_properties (id),
  operation_id         uuid references public.fin_operations (id),
  payment_method       text check (payment_method in (
                         'pix', 'ted', 'boleto', 'cartao_credito', 'cartao_debito',
                         'dinheiro', 'cheque', 'debito_automatico', 'outro'
                       )),
  competence_date      date not null,
  due_date             date,
  is_forecast          boolean not null default false,
  status               text not null default 'open'
                         check (status in ('forecast', 'open', 'partial', 'settled', 'cancelled')),
  settled_amount       numeric(18, 2) not null default 0 check (settled_amount >= 0),
  last_settled_on      date,
  document_number      text,
  notes                text,
  origin               text not null default 'manual' check (origin in (
                         'manual', 'opening_balance', 'commission', 'rental', 'recurrence', 'import'
                       )),
  installment_group_id uuid,
  installment_number   integer,
  installment_count    integer,
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.profiles (id),
  cancel_reason        text,
  created_by           uuid references public.profiles (id),
  updated_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fin_entries_shape_ck check (
    (kind in ('income', 'expense') and category_id is not null
       and transfer_account_id is null and adjustment_direction is null)
    or (kind = 'transfer' and account_id is not null and transfer_account_id is not null
       and account_id <> transfer_account_id and category_id is null and adjustment_direction is null)
    or (kind = 'adjustment' and account_id is not null and adjustment_direction is not null
       and category_id is null and transfer_account_id is null)
  ),
  constraint fin_entries_settled_ck check (settled_amount <= amount),
  constraint fin_entries_forecast_ck check (not is_forecast or kind in ('income', 'expense'))
);

create table if not exists public.fin_settlements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id        uuid not null references public.fin_entries (id),
  account_id      uuid not null references public.fin_accounts (id),
  settled_on      date not null,
  amount          numeric(18, 2) not null check (amount > 0),
  payment_method  text check (payment_method in (
                    'pix', 'ted', 'boleto', 'cartao_credito', 'cartao_debito',
                    'dinheiro', 'cheque', 'debito_automatico', 'outro'
                  )),
  notes           text,
  reversed_at     timestamptz,
  reversed_by     uuid references public.profiles (id),
  reversal_reason text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. Livro-razão
-- -----------------------------------------------------------------------------
create table if not exists public.fin_ledger_batches (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  entry_id          uuid not null references public.fin_entries (id),
  settlement_id     uuid references public.fin_settlements (id),
  kind              text not null check (kind in ('recognition', 'settlement', 'movement', 'reversal')),
  posting_date      date not null,
  reverses_batch_id uuid references public.fin_ledger_batches (id),
  reversed_by_batch uuid references public.fin_ledger_batches (id),
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);

create table if not exists public.fin_postings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id        uuid not null references public.fin_ledger_batches (id),
  entry_id        uuid not null references public.fin_entries (id),
  posting_date    date not null,
  bucket          text not null check (bucket in (
                    'cash', 'receivable', 'payable', 'revenue', 'expense',
                    'third_party', 'deposit', 'equity', 'opening'
                  )),
  account_id      uuid references public.fin_accounts (id),
  category_id     uuid references public.fin_categories (id),
  amount          numeric(18, 2) not null check (amount <> 0),
  created_at      timestamptz not null default now(),
  constraint fin_postings_cash_account_ck check ((bucket = 'cash') = (account_id is not null))
);

-- Índices para relatórios
create index if not exists fin_entries_org_competence_idx
  on public.fin_entries (organization_id, competence_date) where status <> 'cancelled';
create index if not exists fin_entries_org_due_idx
  on public.fin_entries (organization_id, coalesce(due_date, competence_date))
  where status in ('forecast', 'open', 'partial');
create index if not exists fin_entries_category_idx on public.fin_entries (category_id);
create index if not exists fin_entries_operation_idx on public.fin_entries (operation_id) where operation_id is not null;
create index if not exists fin_entries_search_trgm_idx
  on public.fin_entries using gin (description gin_trgm_ops);
create index if not exists fin_settlements_org_date_idx
  on public.fin_settlements (organization_id, settled_on) where reversed_at is null;
create index if not exists fin_settlements_entry_idx on public.fin_settlements (entry_id);
create index if not exists fin_postings_org_bucket_date_idx
  on public.fin_postings (organization_id, bucket, posting_date);
create index if not exists fin_postings_account_idx on public.fin_postings (account_id) where account_id is not null;
create index if not exists fin_postings_batch_idx on public.fin_postings (batch_id);
create index if not exists fin_ledger_batches_entry_idx on public.fin_ledger_batches (entry_id);

-- Toda partida dobrada fecha em zero — verificado no commit da transação.
create or replace function public.fin_assert_batch_balanced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sum numeric;
begin
  select coalesce(sum(amount), 0) into v_sum from public.fin_postings where batch_id = new.batch_id;
  if v_sum <> 0 then
    raise exception 'Lançamento contábil desbalanceado (diferença de %).', v_sum using errcode = 'CF002';
  end if;
  return null;
end;
$$;

drop trigger if exists fin_postings_balanced on public.fin_postings;
create constraint trigger fin_postings_balanced
  after insert on public.fin_postings
  deferrable initially deferred
  for each row execute function public.fin_assert_batch_balanced();

-- Partidas nunca são alteradas nem apagadas: correção = lote de estorno.
create or replace function public.fin_reject_posting_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Partidas do livro-razão são imutáveis. Use um estorno.' using errcode = 'CF004';
end;
$$;

drop trigger if exists fin_postings_immutable on public.fin_postings;
create trigger fin_postings_immutable
  before update or delete on public.fin_postings
  for each row execute function public.fin_reject_posting_mutation();

-- -----------------------------------------------------------------------------
-- 6. Anexos (comprovantes)
-- -----------------------------------------------------------------------------
create table if not exists public.fin_attachments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id        uuid not null references public.fin_entries (id),
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null check (mime_type in (
                    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
                  )),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  description     text,
  uploaded_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists fin_attachments_entry_idx on public.fin_attachments (entry_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 7. Triggers padrão (updated_at e auditoria)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'fin_accounts', 'fin_categories', 'fin_cost_centers', 'fin_counterparties',
    'fin_properties', 'fin_operations', 'fin_entries'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;

  foreach t in array array[
    'fin_accounts', 'fin_categories', 'fin_cost_centers', 'fin_counterparties',
    'fin_properties', 'fin_operations', 'fin_entries', 'fin_settlements', 'fin_attachments'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()',
      t || '_audit', t
    );
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'fin_accounts', 'fin_categories', 'fin_cost_centers', 'fin_counterparties',
    'fin_properties', 'fin_operations', 'fin_entries', 'fin_settlements',
    'fin_ledger_batches', 'fin_postings', 'fin_attachments'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.fin_can(organization_id, ''view''))',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.fin_can(organization_id, ''write'') and public.fin_rpc_context())',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    if t <> 'fin_postings' then
      execute format(
        'create policy %I on public.%I for update to authenticated
           using (public.fin_can(organization_id, ''write''))
           with check (public.fin_can(organization_id, ''write'') and public.fin_rpc_context())',
        t || '_update', t
      );
    end if;

    execute format('grant select, insert on public.%I to authenticated', t);
    if t <> 'fin_postings' then
      execute format('grant update on public.%I to authenticated', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Categorias padrão (plano de contas gerencial de uma imobiliária)
-- -----------------------------------------------------------------------------
create or replace function public.fin_seed_categories(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group  record;
  v_parent uuid;
  v_child  record;
begin
  for v_group in
    select * from (values
      (1, 'Receitas próprias',          'own_revenue',       'grp_own_revenue'),
      (2, 'Outras receitas',            'other_revenue',     'grp_other_revenue'),
      (3, 'Deduções da receita',        'deduction',         'grp_deduction'),
      (4, 'Custos diretos',             'direct_cost',       'grp_direct_cost'),
      (5, 'Despesas operacionais',      'operating_expense', 'grp_operating_expense'),
      (6, 'Outras despesas',            'other_expense',     'grp_other_expense'),
      (7, 'Valores de terceiros',       'third_party',       'grp_third_party'),
      (8, 'Cauções e depósitos',        'deposit',           'grp_deposit'),
      (9, 'Sócios (aportes e retiradas)', 'equity',          'grp_equity')
    ) as g(sort_order, name, nature, system_key)
  loop
    insert into public.fin_categories (organization_id, name, nature, system_key, sort_order)
    values (p_organization_id, v_group.name, v_group.nature, v_group.system_key, v_group.sort_order)
    on conflict (organization_id, system_key) where system_key is not null do nothing;

    select id into v_parent from public.fin_categories
    where organization_id = p_organization_id and system_key = v_group.system_key;

    for v_child in
      select * from (values
        ('grp_own_revenue', 1, 'Comissões de venda',            null,       'commission_sale'),
        ('grp_own_revenue', 2, 'Comissões de locação',          null,       'commission_rental'),
        ('grp_own_revenue', 3, 'Taxa de administração',         null,       'admin_fee'),
        ('grp_own_revenue', 4, 'Taxa de intermediação',         null,       null),
        ('grp_own_revenue', 5, 'Outras receitas operacionais',  null,       null),
        ('grp_other_revenue', 1, 'Rendimentos financeiros',     null,       null),
        ('grp_other_revenue', 2, 'Receitas diversas',           null,       null),
        ('grp_deduction', 1, 'Impostos sobre faturamento',      'variable', null),
        ('grp_direct_cost', 1, 'Custos de operações (documentação, cartório)', 'variable', null),
        ('grp_direct_cost', 2, 'Comissões pagas a parceiros externos', 'variable', null),
        ('grp_operating_expense', 1, 'Aluguel da sede',         'fixed',    null),
        ('grp_operating_expense', 2, 'Condomínio e IPTU da sede', 'fixed',  null),
        ('grp_operating_expense', 3, 'Energia, água e internet', 'fixed',   null),
        ('grp_operating_expense', 4, 'Salários e encargos',     'fixed',    null),
        ('grp_operating_expense', 5, 'Pró-labore',              'fixed',    null),
        ('grp_operating_expense', 6, 'Marketing e anúncios',    'variable', null),
        ('grp_operating_expense', 7, 'Portais imobiliários',    'fixed',    null),
        ('grp_operating_expense', 8, 'Sistemas e software',     'fixed',    null),
        ('grp_operating_expense', 9, 'Contabilidade e jurídico', 'fixed',   null),
        ('grp_operating_expense', 10, 'Material de escritório', 'variable', null),
        ('grp_operating_expense', 11, 'Transporte e combustível', 'variable', null),
        ('grp_operating_expense', 12, 'Tarifas bancárias',      'variable', null),
        ('grp_operating_expense', 13, 'Manutenção e obras',     'variable', null),
        ('grp_operating_expense', 14, 'Outras despesas administrativas', 'variable', null),
        ('grp_other_expense', 1, 'Juros e multas',              null,       null),
        ('grp_other_expense', 2, 'Despesas diversas',           null,       null),
        ('grp_third_party', 1, 'Aluguel recebido para repasse', null,       'rent_third_party'),
        ('grp_third_party', 2, 'Repasse a proprietário',        null,       'owner_transfer'),
        ('grp_third_party', 3, 'Parcela de corretores (recebida)', null,    'broker_share'),
        ('grp_third_party', 4, 'Repasse de comissão a corretor', null,      'broker_payout'),
        ('grp_third_party', 5, 'Outros valores de terceiros',   null,       null),
        ('grp_deposit', 1, 'Caução recebida',                   null,       null),
        ('grp_deposit', 2, 'Devolução de caução',               null,       null),
        ('grp_equity', 1, 'Aporte de sócios',                   null,       null),
        ('grp_equity', 2, 'Retirada de sócios / distribuição de lucros', null, null)
      ) as c(group_key, sort_order, name, cost_behavior, system_key)
      where c.group_key = v_group.system_key
    loop
      if v_child.system_key is not null then
        insert into public.fin_categories (
          organization_id, parent_id, name, nature, cost_behavior, system_key, sort_order
        )
        values (
          p_organization_id, v_parent, v_child.name, v_group.nature, v_child.cost_behavior,
          v_child.system_key, v_child.sort_order
        )
        on conflict (organization_id, system_key) where system_key is not null do nothing;
      elsif not exists (
        select 1 from public.fin_categories
        where organization_id = p_organization_id and parent_id = v_parent
          and lower(btrim(name)) = lower(btrim(v_child.name))
      ) then
        insert into public.fin_categories (
          organization_id, parent_id, name, nature, cost_behavior, sort_order
        )
        values (
          p_organization_id, v_parent, v_child.name, v_group.nature, v_child.cost_behavior,
          v_child.sort_order
        );
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.fin_seed_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fin_seed_categories(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_fin_seed on public.organizations;
create trigger organizations_fin_seed
  after insert on public.organizations
  for each row execute function public.fin_seed_new_organization();

do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform public.fin_seed_categories(v_org);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Núcleo do razão (funções internas usadas pelas RPCs)
-- -----------------------------------------------------------------------------
create or replace function public.fin_nature_direction(p_nature text)
returns text
language sql
immutable
as $$
  select case
    when p_nature in ('own_revenue', 'other_revenue') then 'income'
    when p_nature in ('deduction', 'direct_cost', 'operating_expense', 'other_expense') then 'expense'
    else 'both'
  end;
$$;

create or replace function public.fin_nature_bucket(p_nature text)
returns text
language sql
immutable
as $$
  select case
    when p_nature in ('own_revenue', 'other_revenue') then 'revenue'
    when p_nature in ('deduction', 'direct_cost', 'operating_expense', 'other_expense') then 'expense'
    else p_nature -- third_party, deposit, equity
  end;
$$;

create or replace function public.fin_new_batch(
  p_entry_id      uuid,
  p_settlement_id uuid,
  p_kind          text,
  p_posting_date  date
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.fin_ledger_batches (organization_id, entry_id, settlement_id, kind, posting_date, created_by)
  select e.organization_id, e.id, p_settlement_id, p_kind, p_posting_date, public.current_profile_id()
  from public.fin_entries e where e.id = p_entry_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fin_post(
  p_batch_id    uuid,
  p_bucket      text,
  p_account_id  uuid,
  p_category_id uuid,
  p_amount      numeric
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_amount, 0) = 0 then
    return;
  end if;
  insert into public.fin_postings (organization_id, batch_id, entry_id, posting_date, bucket, account_id, category_id, amount)
  select b.organization_id, b.id, b.entry_id, b.posting_date, p_bucket, p_account_id, p_category_id, p_amount
  from public.fin_ledger_batches b where b.id = p_batch_id;
end;
$$;

-- Reconhecimento do título (regime de competência) ou movimento imediato
-- (transferência/ajuste). Previsões e cancelados não geram partidas.
create or replace function public.fin_post_entry(p_entry_id uuid)
returns void
language plpgsql
as $$
declare
  v_entry  public.fin_entries%rowtype;
  v_bucket text;
  v_batch  uuid;
begin
  select * into v_entry from public.fin_entries where id = p_entry_id;

  if v_entry.cancelled_at is not null or v_entry.is_forecast then
    return;
  end if;

  if v_entry.kind in ('income', 'expense') then
    select public.fin_nature_bucket(c.nature) into v_bucket
    from public.fin_categories c where c.id = v_entry.category_id;

    v_batch := public.fin_new_batch(v_entry.id, null, 'recognition', v_entry.competence_date);
    if v_entry.kind = 'income' then
      perform public.fin_post(v_batch, 'receivable', null, null, v_entry.amount);
      perform public.fin_post(v_batch, v_bucket, null, v_entry.category_id, -v_entry.amount);
    else
      perform public.fin_post(v_batch, v_bucket, null, v_entry.category_id, v_entry.amount);
      perform public.fin_post(v_batch, 'payable', null, null, -v_entry.amount);
    end if;
  elsif v_entry.kind = 'transfer' then
    v_batch := public.fin_new_batch(v_entry.id, null, 'movement', v_entry.competence_date);
    perform public.fin_post(v_batch, 'cash', v_entry.transfer_account_id, null, v_entry.amount);
    perform public.fin_post(v_batch, 'cash', v_entry.account_id, null, -v_entry.amount);
  else
    v_batch := public.fin_new_batch(v_entry.id, null, 'movement', v_entry.competence_date);
    if v_entry.adjustment_direction = 'increase' then
      perform public.fin_post(v_batch, 'cash', v_entry.account_id, null, v_entry.amount);
      perform public.fin_post(v_batch, 'opening', null, null, -v_entry.amount);
    else
      perform public.fin_post(v_batch, 'cash', v_entry.account_id, null, -v_entry.amount);
      perform public.fin_post(v_batch, 'opening', null, null, v_entry.amount);
    end if;
  end if;
end;
$$;

-- Baixa (liquidação): move do receber/pagar para o caixa da conta.
create or replace function public.fin_post_settlement(p_settlement_id uuid)
returns void
language plpgsql
as $$
declare
  v_settlement public.fin_settlements%rowtype;
  v_kind       text;
  v_batch      uuid;
begin
  select * into v_settlement from public.fin_settlements where id = p_settlement_id;
  select kind into v_kind from public.fin_entries where id = v_settlement.entry_id;

  v_batch := public.fin_new_batch(v_settlement.entry_id, v_settlement.id, 'settlement', v_settlement.settled_on);
  if v_kind = 'income' then
    perform public.fin_post(v_batch, 'cash', v_settlement.account_id, null, v_settlement.amount);
    perform public.fin_post(v_batch, 'receivable', null, null, -v_settlement.amount);
  else
    perform public.fin_post(v_batch, 'payable', null, null, v_settlement.amount);
    perform public.fin_post(v_batch, 'cash', v_settlement.account_id, null, -v_settlement.amount);
  end if;
end;
$$;

-- Estorno de um lote: lote espelho com valores invertidos, na mesma data.
create or replace function public.fin_reverse_batch(p_batch_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_batch public.fin_ledger_batches%rowtype;
  v_new   uuid;
begin
  select * into v_batch from public.fin_ledger_batches where id = p_batch_id;
  if v_batch.reversed_by_batch is not null then
    return v_batch.reversed_by_batch;
  end if;

  insert into public.fin_ledger_batches (
    organization_id, entry_id, settlement_id, kind, posting_date, reverses_batch_id, created_by
  )
  values (
    v_batch.organization_id, v_batch.entry_id, v_batch.settlement_id, 'reversal',
    v_batch.posting_date, v_batch.id, public.current_profile_id()
  )
  returning id into v_new;

  insert into public.fin_postings (organization_id, batch_id, entry_id, posting_date, bucket, account_id, category_id, amount)
  select p.organization_id, v_new, p.entry_id, p.posting_date, p.bucket, p.account_id, p.category_id, -p.amount
  from public.fin_postings p where p.batch_id = v_batch.id;

  update public.fin_ledger_batches set reversed_by_batch = v_new where id = v_batch.id;
  return v_new;
end;
$$;

-- Estorna os lotes ativos de um lançamento (por tipo: recognition/movement/settlement).
create or replace function public.fin_reverse_entry_batches(p_entry_id uuid, p_kinds text[])
returns void
language plpgsql
as $$
declare
  v_batch uuid;
begin
  for v_batch in
    select id from public.fin_ledger_batches
    where entry_id = p_entry_id and kind = any (p_kinds) and reversed_by_batch is null
    order by created_at
  loop
    perform public.fin_reverse_batch(v_batch);
  end loop;
end;
$$;

-- Recalcula saldo baixado e status a partir das baixas ativas.
create or replace function public.fin_refresh_entry(p_entry_id uuid)
returns void
language plpgsql
as $$
begin
  update public.fin_entries e
     set settled_amount = case when e.kind in ('transfer', 'adjustment') then e.amount else coalesce(s.total, 0) end,
         last_settled_on = case when e.kind in ('transfer', 'adjustment') then e.competence_date else s.last_on end,
         status = case
           when e.cancelled_at is not null then 'cancelled'
           when e.kind in ('transfer', 'adjustment') then 'settled'
           when e.is_forecast then 'forecast'
           when coalesce(s.total, 0) >= e.amount then 'settled'
           when coalesce(s.total, 0) > 0 then 'partial'
           else 'open'
         end
    from (
      select sum(amount) as total, max(settled_on) as last_on
      from public.fin_settlements
      where entry_id = p_entry_id and reversed_at is null
    ) s
   where e.id = p_entry_id;
end;
$$;

-- Valida um vínculo opcional à organização (conta, categoria, favorecido...).
create or replace function public.fin_assert_owned(p_table text, p_id uuid, p_org uuid, p_label text)
returns void
language plpgsql
as $$
declare
  v_found boolean;
begin
  if p_id is null then
    return;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and organization_id = $2)', p_table)
    into v_found using p_id, p_org;
  if not v_found then
    raise exception '% não encontrado(a).', p_label using errcode = 'CF005';
  end if;
end;
$$;

create or replace function public.fin_category_id(p_org uuid, p_system_key text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.fin_categories
  where organization_id = p_org and system_key = p_system_key;
  if v_id is null then
    raise exception 'Categoria padrão "%" não encontrada. Restaure as categorias do sistema.', p_system_key
      using errcode = 'CF005';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPCs — cadastros
-- -----------------------------------------------------------------------------
create or replace function public.app_fin_save_account(
  p_payload    jsonb,
  p_account_id uuid default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org          uuid := public.fin_require('write');
  v_profile      uuid := public.current_profile_id();
  v_id           uuid := p_account_id;
  v_name         text := btrim(coalesce(p_payload ->> 'name', ''));
  v_opening      numeric := public.fin_money(coalesce((p_payload ->> 'opening_balance')::numeric, 0));
  v_opening_date date := coalesce(nullif(p_payload ->> 'opening_date', '')::date, public.fin_today());
  v_old          public.fin_accounts%rowtype;
  v_opening_id   uuid;
begin
  perform public.set_audit_metadata(p_metadata);

  if length(v_name) = 0 then
    raise exception 'Informe o nome da conta.' using errcode = 'CF002';
  end if;

  if v_id is null then
    insert into public.fin_accounts (
      organization_id, name, kind, bank_name, branch, account_number, opening_balance,
      opening_date, is_active, notes, created_by, updated_by
    )
    values (
      v_org, v_name, coalesce(p_payload ->> 'kind', 'checking'),
      nullif(btrim(coalesce(p_payload ->> 'bank_name', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'branch', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'account_number', '')), ''),
      v_opening, v_opening_date, coalesce((p_payload ->> 'is_active')::boolean, true),
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
    )
    returning id into v_id;
  else
    select * into v_old from public.fin_accounts where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Conta não encontrada.' using errcode = 'CF005';
    end if;

    update public.fin_accounts
       set name = v_name,
           kind = coalesce(p_payload ->> 'kind', kind),
           bank_name = nullif(btrim(coalesce(p_payload ->> 'bank_name', '')), ''),
           branch = nullif(btrim(coalesce(p_payload ->> 'branch', '')), ''),
           account_number = nullif(btrim(coalesce(p_payload ->> 'account_number', '')), ''),
           opening_balance = v_opening,
           opening_date = v_opening_date,
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
           notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           updated_by = v_profile
     where id = v_id;

    if v_old.opening_balance = v_opening and v_old.opening_date = v_opening_date then
      return v_id;
    end if;

    -- Saldo inicial mudou: estorna o lançamento anterior e cria um novo.
    for v_opening_id in
      select id from public.fin_entries
      where account_id = v_id and origin = 'opening_balance' and cancelled_at is null
    loop
      perform public.fin_reverse_entry_batches(v_opening_id, array['movement']);
      update public.fin_entries
         set cancelled_at = now(), cancelled_by = v_profile,
             cancel_reason = 'Saldo inicial da conta alterado.'
       where id = v_opening_id;
      perform public.fin_refresh_entry(v_opening_id);
    end loop;
  end if;

  if v_opening <> 0 then
    insert into public.fin_entries (
      organization_id, kind, description, amount, account_id, adjustment_direction,
      competence_date, origin, notes, created_by, updated_by
    )
    values (
      v_org, 'adjustment', 'Saldo inicial — ' || v_name, abs(v_opening), v_id,
      case when v_opening > 0 then 'increase' else 'decrease' end,
      v_opening_date, 'opening_balance', 'Saldo inicial informado no cadastro da conta.',
      v_profile, v_profile
    )
    returning id into v_opening_id;
    perform public.fin_post_entry(v_opening_id);
    perform public.fin_refresh_entry(v_opening_id);
  end if;

  return v_id;
end;
$$;

create or replace function public.app_fin_save_category(
  p_payload     jsonb,
  p_category_id uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('write');
  v_profile uuid := public.current_profile_id();
  v_id      uuid := p_category_id;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
  v_parent  uuid := nullif(p_payload ->> 'parent_id', '')::uuid;
  v_nature  text := p_payload ->> 'nature';
  v_old     public.fin_categories%rowtype;
  v_parent_nature text;
begin
  perform public.set_audit_metadata(p_metadata);

  if length(v_name) = 0 then
    raise exception 'Informe o nome da categoria.' using errcode = 'CF002';
  end if;

  if v_parent is not null then
    select nature into v_parent_nature from public.fin_categories
    where id = v_parent and organization_id = v_org and parent_id is null;
    if v_parent_nature is null then
      raise exception 'Grupo de categoria inválido.' using errcode = 'CF002';
    end if;
    v_nature := v_parent_nature; -- subcategoria herda a natureza do grupo
  end if;

  if v_nature is null then
    raise exception 'Informe a natureza da categoria.' using errcode = 'CF002';
  end if;

  if v_id is null then
    insert into public.fin_categories (
      organization_id, parent_id, name, nature, cost_behavior, is_active, sort_order, created_by, updated_by
    )
    values (
      v_org, v_parent, v_name, v_nature, nullif(p_payload ->> 'cost_behavior', ''),
      coalesce((p_payload ->> 'is_active')::boolean, true),
      coalesce((p_payload ->> 'sort_order')::integer, 100), v_profile, v_profile
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_old from public.fin_categories where id = v_id and organization_id = v_org;
  if not found then
    raise exception 'Categoria não encontrada.' using errcode = 'CF005';
  end if;

  if v_old.nature <> v_nature and exists (select 1 from public.fin_entries where category_id = v_id) then
    raise exception 'A natureza de uma categoria com lançamentos não pode ser alterada.' using errcode = 'CF002';
  end if;

  if v_old.system_key is not null and coalesce((p_payload ->> 'is_active')::boolean, true) = false then
    raise exception 'Categorias do sistema são usadas pelas operações automáticas e não podem ser desativadas.'
      using errcode = 'CF002';
  end if;

  if v_old.parent_id is null and v_parent is not null then
    raise exception 'Um grupo não pode virar subcategoria.' using errcode = 'CF002';
  end if;

  update public.fin_categories
     set name = v_name,
         parent_id = v_parent,
         nature = v_nature,
         cost_behavior = nullif(p_payload ->> 'cost_behavior', ''),
         is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
         sort_order = coalesce((p_payload ->> 'sort_order')::integer, sort_order),
         updated_by = v_profile
   where id = v_id;

  return v_id;
end;
$$;

create or replace function public.app_fin_save_cost_center(
  p_payload        jsonb,
  p_cost_center_id uuid default null,
  p_metadata       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('write');
  v_profile uuid := public.current_profile_id();
  v_id      uuid := p_cost_center_id;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
begin
  perform public.set_audit_metadata(p_metadata);
  if length(v_name) = 0 then
    raise exception 'Informe o nome do centro de custo.' using errcode = 'CF002';
  end if;

  if v_id is null then
    insert into public.fin_cost_centers (organization_id, name, is_active, created_by, updated_by)
    values (v_org, v_name, coalesce((p_payload ->> 'is_active')::boolean, true), v_profile, v_profile)
    returning id into v_id;
  else
    update public.fin_cost_centers
       set name = v_name, is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active), updated_by = v_profile
     where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Centro de custo não encontrado.' using errcode = 'CF005';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.app_fin_save_counterparty(
  p_payload         jsonb,
  p_counterparty_id uuid default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('write');
  v_profile uuid := public.current_profile_id();
  v_id      uuid := p_counterparty_id;
  v_name    text := btrim(coalesce(p_payload ->> 'name', ''));
  v_broker  uuid := nullif(p_payload ->> 'broker_id', '')::uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  if length(v_name) = 0 then
    raise exception 'Informe o nome do favorecido.' using errcode = 'CF002';
  end if;
  if v_broker is not null and not exists (
    select 1 from public.brokers where id = v_broker and organization_id = v_org
  ) then
    raise exception 'Corretor não encontrado.' using errcode = 'CF005';
  end if;

  if v_id is null then
    insert into public.fin_counterparties (
      organization_id, name, kind, document_number, email, phone, broker_id, notes,
      is_active, created_by, updated_by
    )
    values (
      v_org, v_name, coalesce(p_payload ->> 'kind', 'other'),
      nullif(btrim(coalesce(p_payload ->> 'document_number', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      v_broker, nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
      coalesce((p_payload ->> 'is_active')::boolean, true), v_profile, v_profile
    )
    returning id into v_id;
  else
    update public.fin_counterparties
       set name = v_name,
           kind = coalesce(p_payload ->> 'kind', kind),
           document_number = nullif(btrim(coalesce(p_payload ->> 'document_number', '')), ''),
           email = nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
           phone = nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
           broker_id = v_broker,
           notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
           updated_by = v_profile
     where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Favorecido não encontrado.' using errcode = 'CF005';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.app_fin_save_property(
  p_payload     jsonb,
  p_property_id uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('write');
  v_profile uuid := public.current_profile_id();
  v_id      uuid := p_property_id;
  v_label   text := btrim(coalesce(p_payload ->> 'label', ''));
  v_owner   uuid := nullif(p_payload ->> 'owner_counterparty_id', '')::uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  if length(v_label) = 0 then
    raise exception 'Informe a identificação do imóvel.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_counterparties', v_owner, v_org, 'Proprietário');

  if v_id is null then
    insert into public.fin_properties (
      organization_id, label, address, owner_counterparty_id, admin_fee_rate, is_active, notes,
      created_by, updated_by
    )
    values (
      v_org, v_label, nullif(btrim(coalesce(p_payload ->> 'address', '')), ''), v_owner,
      nullif(p_payload ->> 'admin_fee_rate', '')::numeric,
      coalesce((p_payload ->> 'is_active')::boolean, true),
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
    )
    returning id into v_id;
  else
    update public.fin_properties
       set label = v_label,
           address = nullif(btrim(coalesce(p_payload ->> 'address', '')), ''),
           owner_counterparty_id = v_owner,
           admin_fee_rate = nullif(p_payload ->> 'admin_fee_rate', '')::numeric,
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
           notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           updated_by = v_profile
     where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Imóvel não encontrado.' using errcode = 'CF005';
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. RPCs — lançamentos
-- -----------------------------------------------------------------------------

-- Validação comum de um lançamento já montado (independe de criação/edição).
create or replace function public.fin_validate_entry(p_entry public.fin_entries)
returns void
language plpgsql
as $$
declare
  v_nature    text;
  v_active    boolean;
  v_direction text;
begin
  if p_entry.kind in ('income', 'expense') then
    select nature, is_active into v_nature, v_active
    from public.fin_categories
    where id = p_entry.category_id and organization_id = p_entry.organization_id;
    if v_nature is null then
      raise exception 'Selecione uma categoria.' using errcode = 'CF002';
    end if;
    v_direction := public.fin_nature_direction(v_nature);
    if v_direction <> 'both' and v_direction <> p_entry.kind then
      raise exception '%', case when p_entry.kind = 'income'
        then 'Esta categoria é de despesa e não pode ser usada em uma entrada.'
        else 'Esta categoria é de receita e não pode ser usada em uma saída.' end
        using errcode = 'CF002';
    end if;
  end if;

  perform public.fin_assert_owned('fin_accounts', p_entry.account_id, p_entry.organization_id, 'Conta');
  perform public.fin_assert_owned('fin_accounts', p_entry.transfer_account_id, p_entry.organization_id, 'Conta de destino');
  perform public.fin_assert_owned('fin_counterparties', p_entry.counterparty_id, p_entry.organization_id, 'Favorecido');
  perform public.fin_assert_owned('fin_cost_centers', p_entry.cost_center_id, p_entry.organization_id, 'Centro de custo');
  perform public.fin_assert_owned('fin_properties', p_entry.property_id, p_entry.organization_id, 'Imóvel');

  if p_entry.kind = 'adjustment' and p_entry.origin <> 'opening_balance'
     and length(btrim(coalesce(p_entry.notes, ''))) < 10 then
    raise exception 'Ajustes de saldo exigem uma justificativa com pelo menos 10 caracteres.'
      using errcode = 'CF002';
  end if;
end;
$$;

create or replace function public.fin_insert_settlement(
  p_entry_id       uuid,
  p_account_id     uuid,
  p_settled_on     date,
  p_amount         numeric,
  p_payment_method text,
  p_notes          text
)
returns uuid
language plpgsql
as $$
declare
  v_entry public.fin_entries%rowtype;
  v_id    uuid;
  v_remaining numeric;
begin
  select * into v_entry from public.fin_entries where id = p_entry_id for update;

  if v_entry.kind not in ('income', 'expense') then
    raise exception 'Transferências e ajustes não recebem baixa.' using errcode = 'CF002';
  end if;
  if v_entry.cancelled_at is not null then
    raise exception 'Este lançamento está cancelado.' using errcode = 'CF002';
  end if;
  if p_account_id is null then
    raise exception 'Informe a conta da baixa.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_accounts', p_account_id, v_entry.organization_id, 'Conta');

  -- Pagar uma previsão a transforma em obrigação real.
  if v_entry.is_forecast then
    update public.fin_entries set is_forecast = false where id = v_entry.id;
    perform public.fin_post_entry(v_entry.id);
  end if;

  v_remaining := v_entry.amount - (
    select coalesce(sum(amount), 0) from public.fin_settlements
    where entry_id = v_entry.id and reversed_at is null
  );
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe um valor de baixa maior que zero.' using errcode = 'CF002';
  end if;
  if p_amount > v_remaining then
    raise exception 'O valor da baixa (R$ %) é maior que o saldo em aberto (R$ %).',
      replace(to_char(p_amount, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_remaining, 'FM999999999990.00'), '.', ',')
      using errcode = 'CF002';
  end if;

  insert into public.fin_settlements (
    organization_id, entry_id, account_id, settled_on, amount, payment_method, notes, created_by
  )
  values (
    v_entry.organization_id, v_entry.id, p_account_id, coalesce(p_settled_on, public.fin_today()),
    public.fin_money(p_amount), coalesce(p_payment_method, v_entry.payment_method),
    nullif(btrim(coalesce(p_notes, '')), ''), public.current_profile_id()
  )
  returning id into v_id;

  perform public.fin_post_settlement(v_id);
  perform public.fin_refresh_entry(v_entry.id);
  return v_id;
end;
$$;

-- Cria (com parcelas opcionais) ou edita um lançamento. Retorna os ids criados/editado.
create or replace function public.app_fin_save_entry(
  p_payload  jsonb,
  p_entry_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid[]
language plpgsql
as $$
declare
  v_org          uuid := public.fin_require('write');
  v_profile      uuid := public.current_profile_id();
  v_kind         text := p_payload ->> 'kind';
  v_amount       numeric := public.fin_money((p_payload ->> 'amount')::numeric);
  v_installments integer := greatest(1, least(60, coalesce((p_payload ->> 'installments')::integer, 1)));
  v_competence   date := coalesce(nullif(p_payload ->> 'competence_date', '')::date, public.fin_today());
  v_due          date := nullif(p_payload ->> 'due_date', '')::date;
  v_forecast     boolean := coalesce((p_payload ->> 'is_forecast')::boolean, false);
  v_settle_now   boolean := coalesce((p_payload ->> 'settle_now')::boolean, false);
  v_description  text := btrim(coalesce(p_payload ->> 'description', ''));
  v_ids          uuid[] := array[]::uuid[];
  v_group        uuid;
  v_part         numeric;
  v_last         numeric;
  v_entry        public.fin_entries%rowtype;
  v_old          public.fin_entries%rowtype;
  v_id           uuid;
  i              integer;
  v_repost       boolean;
begin
  perform public.set_audit_metadata(p_metadata);

  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = 'CF002';
  end if;
  if length(v_description) = 0 then
    raise exception 'Informe a descrição do lançamento.' using errcode = 'CF002';
  end if;

  -- ---------------------------------------------------------------- edição
  if p_entry_id is not null then
    select * into v_old from public.fin_entries
    where id = p_entry_id and organization_id = v_org for update;
    if not found then
      raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
    end if;
    if v_old.cancelled_at is not null then
      raise exception 'Lançamentos cancelados não podem ser editados.' using errcode = 'CF002';
    end if;
    if v_kind is not null and v_kind <> v_old.kind then
      raise exception 'O tipo do lançamento não pode ser alterado. Cancele e crie outro.' using errcode = 'CF002';
    end if;

    v_entry := v_old;
    v_entry.description := v_description;
    v_entry.amount := v_amount;
    v_entry.category_id := coalesce(nullif(p_payload ->> 'category_id', '')::uuid, v_old.category_id);
    v_entry.account_id := nullif(p_payload ->> 'account_id', '')::uuid;
    v_entry.transfer_account_id := nullif(p_payload ->> 'transfer_account_id', '')::uuid;
    v_entry.adjustment_direction := nullif(p_payload ->> 'adjustment_direction', '');
    v_entry.counterparty_id := nullif(p_payload ->> 'counterparty_id', '')::uuid;
    v_entry.cost_center_id := nullif(p_payload ->> 'cost_center_id', '')::uuid;
    v_entry.property_id := nullif(p_payload ->> 'property_id', '')::uuid;
    v_entry.payment_method := nullif(p_payload ->> 'payment_method', '');
    v_entry.competence_date := v_competence;
    v_entry.due_date := v_due;
    v_entry.is_forecast := v_forecast;
    v_entry.document_number := nullif(btrim(coalesce(p_payload ->> 'document_number', '')), '');
    v_entry.notes := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');

    -- Lançamentos gerados por operações/saldo inicial só aceitam campos descritivos.
    if v_old.operation_id is not null or v_old.origin = 'opening_balance' then
      if v_entry.amount <> v_old.amount or v_entry.category_id <> v_old.category_id
         or v_entry.competence_date <> v_old.competence_date
         or v_entry.account_id is distinct from v_old.account_id
         or v_entry.is_forecast <> v_old.is_forecast then
        raise exception '%', case when v_old.origin = 'opening_balance'
          then 'O saldo inicial é alterado no cadastro da conta.'
          else 'Valores de lançamentos gerados por uma operação imobiliária não podem ser editados. Cancele a operação e registre novamente.' end
          using errcode = 'CF002';
      end if;
    end if;

    if v_entry.amount < v_old.settled_amount and v_old.kind in ('income', 'expense') then
      raise exception 'O valor não pode ser menor que o total já baixado.' using errcode = 'CF002';
    end if;
    if v_entry.is_forecast and v_old.settled_amount > 0 then
      raise exception 'Um lançamento com baixa não pode voltar a ser previsão.' using errcode = 'CF002';
    end if;

    perform public.fin_validate_entry(v_entry);

    v_repost := v_entry.amount <> v_old.amount
      or v_entry.category_id is distinct from v_old.category_id
      or v_entry.competence_date <> v_old.competence_date
      or v_entry.is_forecast <> v_old.is_forecast
      or v_entry.account_id is distinct from v_old.account_id
      or v_entry.transfer_account_id is distinct from v_old.transfer_account_id
      or v_entry.adjustment_direction is distinct from v_old.adjustment_direction;

    update public.fin_entries
       set description = v_entry.description,
           amount = v_entry.amount,
           category_id = v_entry.category_id,
           account_id = v_entry.account_id,
           transfer_account_id = v_entry.transfer_account_id,
           adjustment_direction = v_entry.adjustment_direction,
           counterparty_id = v_entry.counterparty_id,
           cost_center_id = v_entry.cost_center_id,
           property_id = v_entry.property_id,
           payment_method = v_entry.payment_method,
           competence_date = v_entry.competence_date,
           due_date = v_entry.due_date,
           is_forecast = v_entry.is_forecast,
           document_number = v_entry.document_number,
           notes = v_entry.notes,
           updated_by = v_profile
     where id = v_old.id;

    if v_repost then
      perform public.fin_reverse_entry_batches(v_old.id, array['recognition', 'movement']);
      perform public.fin_post_entry(v_old.id);
    end if;
    perform public.fin_refresh_entry(v_old.id);
    return array[v_old.id];
  end if;

  -- ---------------------------------------------------------------- criação
  if v_kind is null or v_kind not in ('income', 'expense', 'transfer', 'adjustment') then
    raise exception 'Tipo de lançamento inválido.' using errcode = 'CF002';
  end if;
  if v_kind in ('income', 'expense') and nullif(p_payload ->> 'category_id', '') is null then
    raise exception 'Selecione uma categoria.' using errcode = 'CF002';
  end if;
  if v_kind = 'transfer' and (
       nullif(p_payload ->> 'account_id', '') is null
       or nullif(p_payload ->> 'transfer_account_id', '') is null
       or p_payload ->> 'account_id' = p_payload ->> 'transfer_account_id'
     ) then
    raise exception 'Escolha uma conta de origem e uma conta de destino diferentes.' using errcode = 'CF002';
  end if;
  if v_kind = 'adjustment' and (
       nullif(p_payload ->> 'account_id', '') is null
       or coalesce(p_payload ->> 'adjustment_direction', '') not in ('increase', 'decrease')
     ) then
    raise exception 'Informe a conta e se o ajuste aumenta ou diminui o saldo.' using errcode = 'CF002';
  end if;
  if v_settle_now and nullif(coalesce(p_payload ->> 'settlement_account_id', p_payload ->> 'account_id'), '') is null then
    raise exception 'Informe a conta em que o valor foi pago ou recebido.' using errcode = 'CF002';
  end if;
  if v_installments > 1 and (v_kind not in ('income', 'expense') or v_settle_now) then
    raise exception 'Parcelamento vale só para entradas e saídas em aberto.' using errcode = 'CF002';
  end if;
  if v_settle_now and v_forecast then
    raise exception 'Uma previsão não pode ser registrada como já paga.' using errcode = 'CF002';
  end if;

  v_group := case when v_installments > 1 then gen_random_uuid() else null end;
  v_part := trunc(v_amount / v_installments, 2);
  v_last := v_amount - v_part * (v_installments - 1);

  for i in 1..v_installments loop
    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, transfer_account_id,
      adjustment_direction, counterparty_id, cost_center_id, property_id, payment_method,
      competence_date, due_date, is_forecast, document_number, notes, origin,
      installment_group_id, installment_number, installment_count, created_by, updated_by
    )
    values (
      v_org, v_kind,
      case when v_installments > 1 then v_description || ' (' || i || '/' || v_installments || ')' else v_description end,
      case when i = v_installments then v_last else v_part end,
      nullif(p_payload ->> 'category_id', '')::uuid,
      nullif(p_payload ->> 'account_id', '')::uuid,
      nullif(p_payload ->> 'transfer_account_id', '')::uuid,
      nullif(p_payload ->> 'adjustment_direction', ''),
      nullif(p_payload ->> 'counterparty_id', '')::uuid,
      nullif(p_payload ->> 'cost_center_id', '')::uuid,
      nullif(p_payload ->> 'property_id', '')::uuid,
      nullif(p_payload ->> 'payment_method', ''),
      v_competence,
      case when v_due is null then null else (v_due + make_interval(months => i - 1))::date end,
      v_forecast,
      nullif(btrim(coalesce(p_payload ->> 'document_number', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
      'manual',
      v_group,
      case when v_installments > 1 then i else null end,
      case when v_installments > 1 then v_installments else null end,
      v_profile, v_profile
    )
    returning * into v_entry;

    perform public.fin_validate_entry(v_entry);
    perform public.fin_post_entry(v_entry.id);
    perform public.fin_refresh_entry(v_entry.id);
    v_ids := v_ids || v_entry.id;
  end loop;

  if v_settle_now then
    if v_kind not in ('income', 'expense') then
      raise exception 'Somente entradas e saídas recebem baixa.' using errcode = 'CF002';
    end if;
    perform public.fin_insert_settlement(
      v_ids[1],
      coalesce(nullif(p_payload ->> 'settlement_account_id', '')::uuid, nullif(p_payload ->> 'account_id', '')::uuid),
      coalesce(nullif(p_payload ->> 'settled_on', '')::date, v_competence),
      v_amount,
      nullif(p_payload ->> 'payment_method', ''),
      null
    );
  end if;

  return v_ids;
end;
$$;

create or replace function public.app_fin_settle_entry(
  p_entry_id uuid,
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org    uuid := public.fin_require('write');
  v_entry  public.fin_entries%rowtype;
  v_amount numeric;
begin
  perform public.set_audit_metadata(p_metadata);

  select * into v_entry from public.fin_entries where id = p_entry_id and organization_id = v_org;
  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
  end if;

  v_amount := coalesce(
    nullif(p_payload ->> 'amount', '')::numeric,
    v_entry.amount - v_entry.settled_amount
  );

  return public.fin_insert_settlement(
    v_entry.id,
    coalesce(nullif(p_payload ->> 'account_id', '')::uuid, v_entry.account_id),
    nullif(p_payload ->> 'settled_on', '')::date,
    v_amount,
    nullif(p_payload ->> 'payment_method', ''),
    p_payload ->> 'notes'
  );
end;
$$;

create or replace function public.app_fin_reverse_settlement(
  p_settlement_id uuid,
  p_reason        text,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org        uuid := public.fin_require('write');
  v_settlement public.fin_settlements%rowtype;
  v_batch      uuid;
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo do estorno com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;

  select * into v_settlement from public.fin_settlements
  where id = p_settlement_id and organization_id = v_org for update;
  if not found then
    raise exception 'Baixa não encontrada.' using errcode = 'CF005';
  end if;
  if v_settlement.reversed_at is not null then
    raise exception 'Esta baixa já foi estornada.' using errcode = 'CF002';
  end if;

  for v_batch in
    select id from public.fin_ledger_batches
    where settlement_id = v_settlement.id and kind = 'settlement' and reversed_by_batch is null
  loop
    perform public.fin_reverse_batch(v_batch);
  end loop;

  update public.fin_settlements
     set reversed_at = now(), reversed_by = public.current_profile_id(), reversal_reason = btrim(p_reason)
   where id = v_settlement.id;

  perform public.fin_refresh_entry(v_settlement.entry_id);
end;
$$;

-- Cancela um lançamento (estornando baixas e reconhecimento). Exclusão lógica.
create or replace function public.fin_cancel_entry_internal(p_entry_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_settlement uuid;
  v_batch      uuid;
begin
  for v_settlement in
    select id from public.fin_settlements where entry_id = p_entry_id and reversed_at is null
  loop
    for v_batch in
      select id from public.fin_ledger_batches
      where settlement_id = v_settlement and kind = 'settlement' and reversed_by_batch is null
    loop
      perform public.fin_reverse_batch(v_batch);
    end loop;
    update public.fin_settlements
       set reversed_at = now(), reversed_by = public.current_profile_id(),
           reversal_reason = 'Lançamento cancelado: ' || p_reason
     where id = v_settlement;
  end loop;

  perform public.fin_reverse_entry_batches(p_entry_id, array['recognition', 'movement']);

  update public.fin_entries
     set cancelled_at = now(), cancelled_by = public.current_profile_id(), cancel_reason = btrim(p_reason)
   where id = p_entry_id;

  perform public.fin_refresh_entry(p_entry_id);
end;
$$;

create or replace function public.app_fin_cancel_entry(
  p_entry_id uuid,
  p_reason   text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_entry public.fin_entries%rowtype;
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo do cancelamento com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;

  select * into v_entry from public.fin_entries where id = p_entry_id and organization_id = v_org for update;
  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
  end if;
  if v_entry.cancelled_at is not null then
    raise exception 'Este lançamento já está cancelado.' using errcode = 'CF002';
  end if;
  if v_entry.operation_id is not null then
    raise exception 'Este lançamento faz parte de uma operação imobiliária. Cancele a operação inteira.'
      using errcode = 'CF002';
  end if;
  if v_entry.origin = 'opening_balance' then
    raise exception 'O saldo inicial é alterado no cadastro da conta.' using errcode = 'CF002';
  end if;

  perform public.fin_cancel_entry_internal(v_entry.id, p_reason);
end;
$$;

create or replace function public.app_fin_confirm_forecast(
  p_entry_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(p_metadata);
  update public.fin_entries
     set is_forecast = false, updated_by = public.current_profile_id()
   where id = p_entry_id and organization_id = v_org and is_forecast and cancelled_at is null;
  if not found then
    raise exception 'Previsão não encontrada.' using errcode = 'CF005';
  end if;
  perform public.fin_post_entry(p_entry_id);
  perform public.fin_refresh_entry(p_entry_id);
end;
$$;

create or replace function public.app_fin_bulk_categorize(
  p_entry_ids   uuid[],
  p_category_id uuid,
  p_metadata    jsonb default '{}'::jsonb
)
returns integer
language plpgsql
as $$
declare
  v_org       uuid := public.fin_require('write');
  v_nature    text;
  v_direction text;
  v_entry     public.fin_entries%rowtype;
  v_count     integer := 0;
begin
  perform public.set_audit_metadata(p_metadata);

  select nature into v_nature from public.fin_categories
  where id = p_category_id and organization_id = v_org and is_active;
  if v_nature is null then
    raise exception 'Categoria não encontrada.' using errcode = 'CF005';
  end if;
  v_direction := public.fin_nature_direction(v_nature);

  for v_entry in
    select * from public.fin_entries
    where id = any (p_entry_ids) and organization_id = v_org
      and kind in ('income', 'expense') and cancelled_at is null
    for update
  loop
    if v_direction <> 'both' and v_direction <> v_entry.kind then
      raise exception 'A categoria escolhida não é compatível com o lançamento "%".', v_entry.description
        using errcode = 'CF002';
    end if;
    if v_entry.operation_id is not null then
      raise exception 'O lançamento "%" faz parte de uma operação imobiliária e não pode ser recategorizado.',
        v_entry.description using errcode = 'CF002';
    end if;
    if v_entry.category_id = p_category_id then
      continue;
    end if;

    update public.fin_entries
       set category_id = p_category_id, updated_by = public.current_profile_id()
     where id = v_entry.id;
    perform public.fin_reverse_entry_batches(v_entry.id, array['recognition']);
    perform public.fin_post_entry(v_entry.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. RPCs — inteligência imobiliária
-- -----------------------------------------------------------------------------

-- Recebimento de aluguel: o caixa recebe o valor integral, a imobiliária
-- reconhece só a taxa de administração e nasce a obrigação de repasse.
create or replace function public.app_fin_register_rental_collection(
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org         uuid := public.fin_require('write');
  v_profile     uuid := public.current_profile_id();
  v_property    public.fin_properties%rowtype;
  v_property_id uuid := nullif(p_payload ->> 'property_id', '')::uuid;
  v_owner       uuid := nullif(p_payload ->> 'owner_counterparty_id', '')::uuid;
  v_tenant      uuid := nullif(p_payload ->> 'tenant_counterparty_id', '')::uuid;
  v_account     uuid := nullif(p_payload ->> 'account_id', '')::uuid;
  v_rent        numeric := public.fin_money((p_payload ->> 'rent_amount')::numeric);
  v_rate        numeric := nullif(p_payload ->> 'admin_fee_rate', '')::numeric;
  v_fee         numeric := nullif(p_payload ->> 'admin_fee_amount', '')::numeric;
  v_received_on date := coalesce(nullif(p_payload ->> 'received_on', '')::date, public.fin_today());
  v_due         date := coalesce(nullif(p_payload ->> 'transfer_due_date', '')::date, v_received_on);
  v_reference   text := nullif(btrim(coalesce(p_payload ->> 'reference', '')), '');
  v_label       text;
  v_owner_share numeric;
  v_operation   uuid;
  v_entry       uuid;
begin
  perform public.set_audit_metadata(p_metadata);

  if v_property_id is not null then
    select * into v_property from public.fin_properties where id = v_property_id and organization_id = v_org;
    if not found then
      raise exception 'Imóvel não encontrado.' using errcode = 'CF005';
    end if;
    v_owner := coalesce(v_owner, v_property.owner_counterparty_id);
    v_rate := coalesce(v_rate, v_property.admin_fee_rate);
  end if;

  if v_owner is null then
    raise exception 'Informe o proprietário que receberá o repasse.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_counterparties', v_owner, v_org, 'Proprietário');
  perform public.fin_assert_owned('fin_counterparties', v_tenant, v_org, 'Inquilino');
  if v_account is null then
    raise exception 'Informe a conta que recebeu o aluguel.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_accounts', v_account, v_org, 'Conta');
  if v_rent is null or v_rent <= 0 then
    raise exception 'Informe o valor do aluguel recebido.' using errcode = 'CF002';
  end if;

  v_fee := public.fin_money(coalesce(v_fee, v_rent * coalesce(v_rate, 0) / 100));
  if v_fee < 0 or v_fee > v_rent then
    raise exception 'A taxa de administração deve ficar entre zero e o valor do aluguel.' using errcode = 'CF002';
  end if;
  v_owner_share := v_rent - v_fee;

  v_label := coalesce(v_property.label, 'Imóvel') || coalesce(' — ' || v_reference, '');

  insert into public.fin_operations (
    organization_id, kind, description, property_id, counterparty_id, reference_date,
    gross_amount, own_amount, third_party_amount, notes, created_by, updated_by
  )
  values (
    v_org, 'rental_collection', 'Aluguel recebido — ' || v_label, v_property_id, v_owner, v_received_on,
    v_rent, v_fee, v_owner_share, nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
  )
  returning id into v_operation;

  if v_owner_share > 0 then
    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id,
      property_id, operation_id, competence_date, due_date, payment_method, origin, created_by, updated_by
    )
    values (
      v_org, 'income', 'Aluguel recebido (parte do proprietário) — ' || v_label, v_owner_share,
      public.fin_category_id(v_org, 'rent_third_party'), v_account, coalesce(v_tenant, v_owner),
      v_property_id, v_operation, v_received_on, v_received_on, nullif(p_payload ->> 'payment_method', ''),
      'rental', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_insert_settlement(v_entry, v_account, v_received_on, v_owner_share, null, null);
  end if;

  if v_fee > 0 then
    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id,
      property_id, operation_id, competence_date, due_date, payment_method, origin, created_by, updated_by
    )
    values (
      v_org, 'income', 'Taxa de administração — ' || v_label, v_fee,
      public.fin_category_id(v_org, 'admin_fee'), v_account, v_owner,
      v_property_id, v_operation, v_received_on, v_received_on, nullif(p_payload ->> 'payment_method', ''),
      'rental', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_insert_settlement(v_entry, v_account, v_received_on, v_fee, null, null);
  end if;

  if v_owner_share > 0 then
    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id,
      property_id, operation_id, competence_date, due_date, origin, created_by, updated_by
    )
    values (
      v_org, 'expense', 'Repasse ao proprietário — ' || v_label, v_owner_share,
      public.fin_category_id(v_org, 'owner_transfer'), v_account, v_owner,
      v_property_id, v_operation, v_received_on, v_due, 'rental', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_refresh_entry(v_entry);
  end if;

  return v_operation;
end;
$$;

-- Comissão recebida: entra no caixa o valor bruto da comissão (nunca o valor
-- do imóvel); só a parte líquida da imobiliária vira receita própria; a parte
-- de cada corretor vira obrigação de repasse.
create or replace function public.app_fin_register_commission_receipt(
  p_commission_entry_id uuid,
  p_payload             jsonb,
  p_metadata            jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org          uuid := public.fin_require('write');
  v_profile      uuid := public.current_profile_id();
  v_account      uuid := nullif(p_payload ->> 'account_id', '')::uuid;
  v_received_on  date := coalesce(nullif(p_payload ->> 'received_on', '')::date, public.fin_today());
  v_due          date := coalesce(nullif(p_payload ->> 'broker_due_date', '')::date, v_received_on);
  v_totals       record;
  v_split        record;
  v_operation    uuid;
  v_entry        uuid;
  v_counterparty uuid;
  v_own_category uuid;
begin
  perform public.set_audit_metadata(p_metadata);

  select * into v_totals from public.financial_entry_totals
  where entry_id = p_commission_entry_id and organization_id = v_org and deleted_at is null;
  if not found then
    raise exception 'Comissão não encontrada.' using errcode = 'CF005';
  end if;
  if v_totals.exception_confirmed or v_totals.net_company_revenue < 0 then
    raise exception 'Comissões com exceção financeira (repasses maiores que a comissão) devem ser lançadas manualmente.'
      using errcode = 'CF002';
  end if;
  if v_totals.gross_commission <= 0 then
    raise exception 'Esta comissão não tem valor a receber.' using errcode = 'CF002';
  end if;
  if exists (
    select 1 from public.fin_operations
    where organization_id = v_org and commission_entry_id = p_commission_entry_id and cancelled_at is null
  ) then
    raise exception 'Esta comissão já foi lançada no caixa.' using errcode = 'CF003';
  end if;
  if v_account is null then
    raise exception 'Informe a conta que recebeu a comissão.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_accounts', v_account, v_org, 'Conta');

  v_own_category := public.fin_category_id(
    v_org, case when v_totals.entry_type = 'sale' then 'commission_sale' else 'commission_rental' end
  );

  insert into public.fin_operations (
    organization_id, kind, description, commission_entry_id, reference_date,
    gross_amount, own_amount, third_party_amount, created_by, updated_by
  )
  values (
    v_org, 'commission_receipt', 'Comissão recebida — ' || v_totals.description, p_commission_entry_id,
    v_received_on, v_totals.gross_commission, v_totals.net_company_revenue,
    v_totals.total_broker_payout, v_profile, v_profile
  )
  returning id into v_operation;

  if v_totals.net_company_revenue > 0 then
    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, operation_id,
      competence_date, due_date, origin, created_by, updated_by
    )
    values (
      v_org, 'income', 'Comissão (parte da imobiliária) — ' || v_totals.description,
      v_totals.net_company_revenue, v_own_category, v_account, v_operation,
      v_received_on, v_received_on, 'commission', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_insert_settlement(v_entry, v_account, v_received_on, v_totals.net_company_revenue, null, null);
  end if;

  for v_split in
    select broker_id, broker_name, payout_amount
    from public.entry_split_amounts
    where entry_id = p_commission_entry_id and deleted_at is null and payout_amount > 0
    order by broker_name
  loop
    select id into v_counterparty from public.fin_counterparties
    where organization_id = v_org and broker_id = v_split.broker_id;
    if v_counterparty is null then
      select id into v_counterparty from public.fin_counterparties
      where organization_id = v_org and public.normalized_name(name) = public.normalized_name(v_split.broker_name);
      if v_counterparty is null then
        insert into public.fin_counterparties (organization_id, name, kind, broker_id, created_by, updated_by)
        values (v_org, v_split.broker_name, 'broker', v_split.broker_id, v_profile, v_profile)
        returning id into v_counterparty;
      end if;
    end if;

    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id,
      operation_id, competence_date, due_date, origin, created_by, updated_by
    )
    values (
      v_org, 'income', 'Comissão (parte de ' || v_split.broker_name || ') — ' || v_totals.description,
      v_split.payout_amount, public.fin_category_id(v_org, 'broker_share'), v_account, v_counterparty,
      v_operation, v_received_on, v_received_on, 'commission', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_insert_settlement(v_entry, v_account, v_received_on, v_split.payout_amount, null, null);

    insert into public.fin_entries (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id,
      operation_id, competence_date, due_date, origin, created_by, updated_by
    )
    values (
      v_org, 'expense', 'Repasse de comissão a ' || v_split.broker_name || ' — ' || v_totals.description,
      v_split.payout_amount, public.fin_category_id(v_org, 'broker_payout'), v_account, v_counterparty,
      v_operation, v_received_on, v_due, 'commission', v_profile, v_profile
    )
    returning id into v_entry;
    perform public.fin_post_entry(v_entry);
    perform public.fin_refresh_entry(v_entry);
  end loop;

  return v_operation;
end;
$$;

create or replace function public.app_fin_cancel_operation(
  p_operation_id uuid,
  p_reason       text,
  p_metadata     jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_entry uuid;
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo do cancelamento com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;

  update public.fin_operations
     set cancelled_at = now(), cancelled_by = public.current_profile_id(), cancel_reason = btrim(p_reason)
   where id = p_operation_id and organization_id = v_org and cancelled_at is null;
  if not found then
    raise exception 'Operação não encontrada ou já cancelada.' using errcode = 'CF005';
  end if;

  for v_entry in
    select id from public.fin_entries where operation_id = p_operation_id and cancelled_at is null
  loop
    perform public.fin_cancel_entry_internal(v_entry, p_reason);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. RPCs — anexos e permissões
-- -----------------------------------------------------------------------------
create or replace function public.app_fin_register_attachment(
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_entry uuid := (p_payload ->> 'entry_id')::uuid;
  v_id    uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  perform public.fin_assert_owned('fin_entries', v_entry, v_org, 'Lançamento');

  insert into public.fin_attachments (
    organization_id, entry_id, storage_path, file_name, mime_type, file_size_bytes, description, uploaded_by
  )
  values (
    v_org, v_entry, p_payload ->> 'storage_path', p_payload ->> 'file_name', p_payload ->> 'mime_type',
    (p_payload ->> 'file_size_bytes')::integer,
    nullif(btrim(coalesce(p_payload ->> 'description', '')), ''), public.current_profile_id()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_fin_delete_attachment(
  p_attachment_id uuid,
  p_metadata      jsonb default '{}'::jsonb
)
returns text
language plpgsql
as $$
declare
  v_org  uuid := public.fin_require('write');
  v_path text;
begin
  perform public.set_audit_metadata(p_metadata);
  update public.fin_attachments set deleted_at = now()
   where id = p_attachment_id and organization_id = v_org and deleted_at is null
   returning storage_path into v_path;
  if v_path is null then
    raise exception 'Anexo não encontrado.' using errcode = 'CF005';
  end if;
  return v_path;
end;
$$;

-- Somente o proprietário define o perfil financeiro dos demais membros.
create or replace function public.app_set_member_finance_role(
  p_member_id uuid,
  p_role      text,
  p_metadata  jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.app_require_org();
  v_member public.organization_members%rowtype;
begin
  perform public.set_audit_metadata(p_metadata);

  if not public.is_organization_owner(v_org) then
    raise exception 'Somente o proprietário altera permissões financeiras.' using errcode = 'CF004';
  end if;
  if p_role not in ('admin', 'financeiro', 'gestor', 'consulta', 'sem_acesso') then
    raise exception 'Perfil financeiro inválido.' using errcode = 'CF002';
  end if;

  select * into v_member from public.organization_members where id = p_member_id and organization_id = v_org;
  if not found then
    raise exception 'Membro não encontrado.' using errcode = 'CF005';
  end if;
  if v_member.role = 'owner' then
    raise exception 'O proprietário é sempre administrador financeiro.' using errcode = 'CF002';
  end if;

  update public.organization_members set finance_role = p_role where id = p_member_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Leitura — detalhe dos lançamentos
-- -----------------------------------------------------------------------------
drop view if exists public.fin_entries_detail cascade;
create view public.fin_entries_detail
with (security_invoker = true) as
select
  e.id,
  e.organization_id,
  e.kind,
  e.description,
  e.amount,
  e.settled_amount,
  public.fin_money(e.amount - e.settled_amount)          as remaining_amount,
  e.status,
  e.is_forecast,
  e.category_id,
  c.name                                                  as category_name,
  c.nature,
  c.parent_id                                             as category_parent_id,
  pc.name                                                 as category_parent_name,
  e.account_id,
  a.name                                                  as account_name,
  e.transfer_account_id,
  ta.name                                                 as transfer_account_name,
  e.adjustment_direction,
  e.counterparty_id,
  cp.name                                                 as counterparty_name,
  e.cost_center_id,
  cc.name                                                 as cost_center_name,
  e.property_id,
  pr.label                                                as property_label,
  e.operation_id,
  o.kind                                                  as operation_kind,
  e.payment_method,
  e.competence_date,
  e.due_date,
  coalesce(e.due_date, e.competence_date)                 as reference_date,
  e.last_settled_on,
  (e.status in ('forecast', 'open', 'partial')
     and coalesce(e.due_date, e.competence_date) < public.fin_today()) as is_overdue,
  e.document_number,
  e.notes,
  e.origin,
  e.installment_group_id,
  e.installment_number,
  e.installment_count,
  e.cancelled_at,
  e.cancel_reason,
  e.created_by,
  e.created_at,
  e.updated_at,
  (select count(*)::integer from public.fin_attachments at
     where at.entry_id = e.id and at.deleted_at is null)  as attachments_count
from public.fin_entries e
left join public.fin_categories c  on c.id = e.category_id
left join public.fin_categories pc on pc.id = c.parent_id
left join public.fin_accounts a    on a.id = e.account_id
left join public.fin_accounts ta   on ta.id = e.transfer_account_id
left join public.fin_counterparties cp on cp.id = e.counterparty_id
left join public.fin_cost_centers cc on cc.id = e.cost_center_id
left join public.fin_properties pr on pr.id = e.property_id
left join public.fin_operations o  on o.id = e.operation_id;

grant select on public.fin_entries_detail to authenticated;

-- -----------------------------------------------------------------------------
-- 16. Relatórios (fonte única para dashboard, relatórios e exportações)
-- -----------------------------------------------------------------------------

-- Itens de resultado no regime escolhido:
--   competencia → valor do título na data de competência (exceto previsão/cancelado)
--   caixa       → valor de cada baixa ativa na data da baixa
create or replace function public.fin_pl_items(p_from date, p_to date, p_regime text)
returns table (
  entry_id    uuid,
  item_date   date,
  kind        text,
  category_id uuid,
  parent_id   uuid,
  nature      text,
  account_id  uuid,
  amount      numeric
)
language sql
stable
as $$
  select e.id, e.competence_date, e.kind, e.category_id, c.parent_id, c.nature, e.account_id, e.amount
  from public.fin_entries e
  join public.fin_categories c on c.id = e.category_id
  where p_regime = 'competencia'
    and e.organization_id = public.app_current_org()
    and e.kind in ('income', 'expense')
    and e.status not in ('cancelled', 'forecast')
    and e.competence_date between p_from and p_to
  union all
  select e.id, s.settled_on, e.kind, e.category_id, c.parent_id, c.nature, s.account_id, s.amount
  from public.fin_settlements s
  join public.fin_entries e on e.id = s.entry_id
  join public.fin_categories c on c.id = e.category_id
  where p_regime <> 'competencia'
    and s.organization_id = public.app_current_org()
    and s.reversed_at is null
    and s.settled_on between p_from and p_to;
$$;

-- Contribuição de um item ao resultado (positivo = melhora o resultado).
create or replace function public.fin_result_sign(p_nature text)
returns integer
language sql
immutable
as $$
  select case
    when p_nature in ('own_revenue', 'other_revenue') then 1
    when p_nature in ('deduction', 'direct_cost', 'operating_expense', 'other_expense') then -1
    else 0
  end;
$$;

create or replace function public.fin_report_summary(
  p_from        date,
  p_to          date,
  p_regime      text default 'caixa',
  p_account_id  uuid default null,
  p_category_id uuid default null,
  p_nature      text default null
)
returns table (
  cash_balance             numeric,
  cash_in                  numeric,
  cash_out                 numeric,
  own_revenue              numeric,
  other_revenue            numeric,
  deductions               numeric,
  direct_costs             numeric,
  operating_expenses       numeric,
  other_expenses           numeric,
  net_result               numeric,
  partner_withdrawals      numeric,
  receivables_open         numeric,
  receivables_overdue      numeric,
  payables_open            numeric,
  payables_overdue         numeric,
  third_party_obligations  numeric,
  deposits_held            numeric,
  broker_payouts_pending   numeric,
  commissions_not_in_cash  numeric,
  commissions_not_in_cash_count integer,
  own_available            numeric,
  forecast_30_balance      numeric
)
language sql
stable
as $$
  with org as (select public.app_current_org() as id),
  pl as (
    select i.*
    from public.fin_pl_items(p_from, p_to, coalesce(p_regime, 'caixa')) i
    where (p_account_id is null or i.account_id = p_account_id)
      and (p_category_id is null or i.category_id = p_category_id or i.parent_id = p_category_id)
      and (p_nature is null or i.nature = p_nature)
  ),
  pl_totals as (
    select
      coalesce(sum(amount) filter (where nature = 'own_revenue'), 0)       as own_revenue,
      coalesce(sum(amount) filter (where nature = 'other_revenue'), 0)     as other_revenue,
      coalesce(sum(amount) filter (where nature = 'deduction'), 0)         as deductions,
      coalesce(sum(amount) filter (where nature = 'direct_cost'), 0)       as direct_costs,
      coalesce(sum(amount) filter (where nature = 'operating_expense'), 0) as operating_expenses,
      coalesce(sum(amount) filter (where nature = 'other_expense'), 0)     as other_expenses,
      coalesce(sum(amount) filter (where nature = 'equity' and kind = 'expense'), 0) as partner_withdrawals
    from pl
  ),
  cash as (
    select
      coalesce(sum(p.amount) filter (where p.posting_date <= p_to), 0) as balance
    from public.fin_postings p, org
    where p.organization_id = org.id and p.bucket = 'cash'
      and (p_account_id is null or p.account_id = p_account_id)
  ),
  flows as (
    select
      coalesce(sum(s.amount) filter (where e.kind = 'income'), 0)  as cash_in,
      coalesce(sum(s.amount) filter (where e.kind = 'expense'), 0) as cash_out
    from public.fin_settlements s
    join public.fin_entries e on e.id = s.entry_id, org
    where s.organization_id = org.id
      and s.reversed_at is null
      and s.settled_on between p_from and p_to
      and (p_account_id is null or s.account_id = p_account_id)
  ),
  open_items as (
    select
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'income' and d.status in ('open', 'partial')), 0) as receivables_open,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'income' and d.status in ('open', 'partial') and d.is_overdue), 0) as receivables_overdue,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense' and d.status in ('open', 'partial') and d.nature <> 'third_party'), 0) as payables_open,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense' and d.status in ('open', 'partial') and d.nature <> 'third_party' and d.is_overdue), 0) as payables_overdue,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense' and d.status in ('open', 'partial') and d.nature = 'third_party'), 0) as third_party_payables,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense' and d.status in ('open', 'partial') and d.operation_kind = 'commission_receipt'), 0) as broker_payouts_pending
    from public.fin_entries_detail d, org
    where d.organization_id = org.id
  ),
  liabilities as (
    select
      -coalesce(sum(p.amount) filter (where p.bucket = 'third_party'), 0) as third_party_unscheduled,
      -coalesce(sum(p.amount) filter (where p.bucket = 'deposit'), 0)     as deposits_held
    from public.fin_postings p, org
    where p.organization_id = org.id and p.posting_date <= p_to
  ),
  commissions as (
    select
      coalesce(sum(t.gross_commission), 0) as amount,
      count(*)::integer                    as quantity
    from public.financial_entry_totals t, org
    where t.organization_id = org.id
      and t.deleted_at is null
      and t.entry_date between p_from and p_to
      and t.gross_commission > 0
      and not exists (
        select 1 from public.fin_operations o
        where o.commission_entry_id = t.entry_id and o.cancelled_at is null
      )
  ),
  forecast as (
    select
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'income'), 0)  as incoming,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense'), 0) as outgoing
    from public.fin_entries_detail d, org
    where d.organization_id = org.id
      and d.status in ('forecast', 'open', 'partial')
      and d.reference_date <= public.fin_today() + 30
  ),
  cash_today as (
    select coalesce(sum(p.amount), 0) as balance
    from public.fin_postings p, org
    where p.organization_id = org.id and p.bucket = 'cash' and p.posting_date <= public.fin_today()
  )
  select
    cash.balance,
    flows.cash_in,
    flows.cash_out,
    pl_totals.own_revenue,
    pl_totals.other_revenue,
    pl_totals.deductions,
    pl_totals.direct_costs,
    pl_totals.operating_expenses,
    pl_totals.other_expenses,
    pl_totals.own_revenue + pl_totals.other_revenue - pl_totals.deductions - pl_totals.direct_costs
      - pl_totals.operating_expenses - pl_totals.other_expenses,
    pl_totals.partner_withdrawals,
    open_items.receivables_open,
    open_items.receivables_overdue,
    open_items.payables_open,
    open_items.payables_overdue,
    open_items.third_party_payables + liabilities.third_party_unscheduled,
    liabilities.deposits_held,
    open_items.broker_payouts_pending,
    commissions.amount,
    commissions.quantity,
    cash.balance - open_items.third_party_payables - liabilities.third_party_unscheduled - liabilities.deposits_held,
    cash_today.balance + forecast.incoming - forecast.outgoing
  from cash, flows, pl_totals, open_items, liabilities, commissions, forecast, cash_today;
$$;

-- Série mensal: resultado (regime escolhido), fluxo de caixa e previsto x realizado.
create or replace function public.fin_report_monthly(
  p_from        date,
  p_to          date,
  p_regime      text default 'caixa',
  p_account_id  uuid default null,
  p_category_id uuid default null,
  p_nature      text default null
)
returns table (
  period_key        text,
  year              integer,
  month             integer,
  revenue           numeric,
  expenses          numeric,
  result            numeric,
  cash_in           numeric,
  cash_out          numeric,
  closing_balance   numeric,
  planned_in        numeric,
  planned_out       numeric
)
language sql
stable
as $$
  with org as (select public.app_current_org() as id),
  months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month_start
  ),
  pl as (
    select date_trunc('month', i.item_date)::date as month_start,
      sum(i.amount) filter (where public.fin_result_sign(i.nature) = 1)  as revenue,
      sum(i.amount) filter (where public.fin_result_sign(i.nature) = -1) as expenses
    from public.fin_pl_items(date_trunc('month', p_from)::date, p_to, coalesce(p_regime, 'caixa')) i
    where (p_account_id is null or i.account_id = p_account_id)
      and (p_category_id is null or i.category_id = p_category_id or i.parent_id = p_category_id)
      and (p_nature is null or i.nature = p_nature)
    group by 1
  ),
  flows as (
    select date_trunc('month', s.settled_on)::date as month_start,
      sum(s.amount) filter (where e.kind = 'income')  as cash_in,
      sum(s.amount) filter (where e.kind = 'expense') as cash_out
    from public.fin_settlements s
    join public.fin_entries e on e.id = s.entry_id, org
    where s.organization_id = org.id
      and s.reversed_at is null
      and s.settled_on between date_trunc('month', p_from)::date and p_to
      and (p_account_id is null or s.account_id = p_account_id)
    group by 1
  ),
  planned as (
    select date_trunc('month', coalesce(e.due_date, e.competence_date))::date as month_start,
      sum(e.amount) filter (where e.kind = 'income')  as planned_in,
      sum(e.amount) filter (where e.kind = 'expense') as planned_out
    from public.fin_entries e, org
    where e.organization_id = org.id
      and e.kind in ('income', 'expense')
      and e.status <> 'cancelled'
      and coalesce(e.due_date, e.competence_date) between date_trunc('month', p_from)::date and p_to
      and (p_account_id is null or e.account_id = p_account_id)
    group by 1
  ),
  balances as (
    select m.month_start,
      (select coalesce(sum(p.amount), 0) from public.fin_postings p, org
        where p.organization_id = org.id and p.bucket = 'cash'
          and (p_account_id is null or p.account_id = p_account_id)
          and p.posting_date < (m.month_start + interval '1 month')::date) as closing_balance
    from months m
  )
  select
    to_char(m.month_start, 'YYYY-MM'),
    extract(year from m.month_start)::integer,
    extract(month from m.month_start)::integer,
    coalesce(pl.revenue, 0),
    coalesce(pl.expenses, 0),
    coalesce(pl.revenue, 0) - coalesce(pl.expenses, 0),
    coalesce(flows.cash_in, 0),
    coalesce(flows.cash_out, 0),
    b.closing_balance,
    coalesce(planned.planned_in, 0),
    coalesce(planned.planned_out, 0)
  from months m
  left join pl on pl.month_start = m.month_start
  left join flows on flows.month_start = m.month_start
  left join planned on planned.month_start = m.month_start
  join balances b on b.month_start = m.month_start
  order by m.month_start;
$$;

create or replace function public.fin_report_by_category(
  p_from       date,
  p_to         date,
  p_regime     text default 'caixa',
  p_kind       text default 'expense',
  p_account_id uuid default null
)
returns table (
  category_id   uuid,
  category_name text,
  group_name    text,
  nature        text,
  total         numeric,
  items_count   integer
)
language sql
stable
as $$
  select
    i.category_id,
    c.name,
    coalesce(g.name, c.name),
    i.nature,
    sum(i.amount),
    count(*)::integer
  from public.fin_pl_items(p_from, p_to, coalesce(p_regime, 'caixa')) i
  join public.fin_categories c on c.id = i.category_id
  left join public.fin_categories g on g.id = c.parent_id
  where i.kind = p_kind
    and (p_account_id is null or i.account_id = p_account_id)
  group by i.category_id, c.name, g.name, i.nature
  order by sum(i.amount) desc;
$$;

create or replace function public.fin_account_balances(p_date date default null)
returns table (
  account_id uuid,
  name       text,
  kind       text,
  is_active  boolean,
  balance    numeric
)
language sql
stable
as $$
  select a.id, a.name, a.kind, a.is_active,
    coalesce((
      select sum(p.amount) from public.fin_postings p
      where p.account_id = a.id and p.bucket = 'cash'
        and p.posting_date <= coalesce(p_date, public.fin_today())
    ), 0)
  from public.fin_accounts a
  where a.organization_id = public.app_current_org()
  order by a.is_active desc, a.name;
$$;

-- Resultado por imóvel (taxa de administração e repasses).
create or replace function public.fin_report_properties(p_from date, p_to date)
returns table (
  property_id        uuid,
  label              text,
  rent_collected     numeric,
  own_revenue        numeric,
  owner_transferred  numeric,
  owner_pending      numeric,
  direct_expenses    numeric,
  result             numeric
)
language sql
stable
as $$
  select
    pr.id,
    pr.label,
    coalesce(sum(o.gross_amount) filter (where o.cancelled_at is null and o.reference_date between p_from and p_to), 0),
    coalesce((select sum(i.amount) from public.fin_pl_items(p_from, p_to, 'competencia') i
               join public.fin_entries e on e.id = i.entry_id
               where e.property_id = pr.id and i.nature in ('own_revenue', 'other_revenue')), 0),
    coalesce((select sum(s.amount) from public.fin_settlements s
               join public.fin_entries e on e.id = s.entry_id
               join public.fin_categories c on c.id = e.category_id
               where e.property_id = pr.id and e.kind = 'expense' and c.nature = 'third_party'
                 and s.reversed_at is null and s.settled_on between p_from and p_to), 0),
    coalesce((select sum(d.remaining_amount) from public.fin_entries_detail d
               where d.property_id = pr.id and d.kind = 'expense' and d.nature = 'third_party'
                 and d.status in ('open', 'partial')), 0),
    coalesce((select sum(i.amount) from public.fin_pl_items(p_from, p_to, 'competencia') i
               join public.fin_entries e on e.id = i.entry_id
               where e.property_id = pr.id and public.fin_result_sign(i.nature) = -1), 0),
    coalesce((select sum(i.amount * public.fin_result_sign(i.nature)) from public.fin_pl_items(p_from, p_to, 'competencia') i
               join public.fin_entries e on e.id = i.entry_id
               where e.property_id = pr.id), 0)
  from public.fin_properties pr
  left join public.fin_operations o on o.property_id = pr.id
  where pr.organization_id = public.app_current_org()
  group by pr.id, pr.label
  order by pr.label;
$$;

-- Sugestão de categoria a partir do histórico (mesmo favorecido ou descrição
-- parecida). É só sugestão: nunca é aplicada sem o usuário confirmar.
create or replace function public.fin_suggest_category(
  p_kind            text,
  p_description     text,
  p_counterparty_id uuid default null
)
returns table (category_id uuid, category_name text, matches integer, reason text)
language sql
stable
as $$
  with candidates as (
    select
      e.category_id,
      c.name,
      (p_counterparty_id is not null and e.counterparty_id = p_counterparty_id) as by_counterparty,
      (case when p_counterparty_id is not null and e.counterparty_id = p_counterparty_id then 2 else 0 end
        + case when similarity(lower(e.description), lower(coalesce(p_description, ''))) >= 0.35 then 1 else 0 end) as score
    from public.fin_entries e
    join public.fin_categories c on c.id = e.category_id
    where e.organization_id = public.app_current_org()
      and e.kind = p_kind
      and e.cancelled_at is null
      and e.origin = 'manual'
      and c.is_active
      and (
        (p_counterparty_id is not null and e.counterparty_id = p_counterparty_id)
        or (length(btrim(coalesce(p_description, ''))) >= 3
            and similarity(lower(e.description), lower(p_description)) >= 0.35)
      )
  )
  select
    category_id,
    name,
    count(*)::integer,
    case
      when bool_or(by_counterparty) then 'Usada com este favorecido em ' || count(*) || ' lançamento(s) anterior(es).'
      else 'Usada em ' || count(*) || ' lançamento(s) com descrição parecida.'
    end
  from candidates
  group by category_id, name
  order by sum(score) desc, count(*) desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 17. Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.fin_seed_categories(uuid),
  public.fin_seed_new_organization()
from public, anon, authenticated;

grant execute on function
  public.fin_current_role(uuid),
  public.fin_can(uuid, text),
  public.app_fin_save_account(jsonb, uuid, jsonb),
  public.app_fin_save_category(jsonb, uuid, jsonb),
  public.app_fin_save_cost_center(jsonb, uuid, jsonb),
  public.app_fin_save_counterparty(jsonb, uuid, jsonb),
  public.app_fin_save_property(jsonb, uuid, jsonb),
  public.app_fin_save_entry(jsonb, uuid, jsonb),
  public.app_fin_settle_entry(uuid, jsonb, jsonb),
  public.app_fin_reverse_settlement(uuid, text, jsonb),
  public.app_fin_cancel_entry(uuid, text, jsonb),
  public.app_fin_confirm_forecast(uuid, jsonb),
  public.app_fin_bulk_categorize(uuid[], uuid, jsonb),
  public.app_fin_register_rental_collection(jsonb, jsonb),
  public.app_fin_register_commission_receipt(uuid, jsonb, jsonb),
  public.app_fin_cancel_operation(uuid, text, jsonb),
  public.app_fin_register_attachment(jsonb, jsonb),
  public.app_fin_delete_attachment(uuid, jsonb),
  public.app_set_member_finance_role(uuid, text, jsonb),
  public.fin_report_summary(date, date, text, uuid, uuid, text),
  public.fin_report_monthly(date, date, text, uuid, uuid, text),
  public.fin_report_by_category(date, date, text, text, uuid),
  public.fin_account_balances(date),
  public.fin_report_properties(date, date),
  public.fin_suggest_category(text, text, uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- 18. Storage — comprovantes financeiros (bucket privado)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'finance-attachments', 'finance-attachments', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      )
      on conflict (id) do nothing
    $sql$;

    execute 'drop policy if exists finance_attachments_select on storage.objects';
    execute $sql$
      create policy finance_attachments_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'finance-attachments'
          and public.fin_can((storage.foldername(name))[1]::uuid, 'view')
        )
    $sql$;

    execute 'drop policy if exists finance_attachments_insert on storage.objects';
    execute $sql$
      create policy finance_attachments_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'finance-attachments'
          and public.fin_can((storage.foldername(name))[1]::uuid, 'write')
        )
    $sql$;

    execute 'drop policy if exists finance_attachments_delete on storage.objects';
    execute $sql$
      create policy finance_attachments_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'finance-attachments'
          and public.fin_can((storage.foldername(name))[1]::uuid, 'write')
        )
    $sql$;
  end if;
end
$$;

-- ===================== 0011_finance_reconciliation.sql =====================
-- =============================================================================
-- 0011 — Controle Financeiro, Fase 2: conciliação bancária e automação
--
-- * Importação de extratos (OFX/CSV) por conta, idempotente por linha
--   (FITID do OFX ou impressão digital da linha no CSV).
-- * Conciliação: cada linha do extrato é ligada a UM movimento de caixa do
--   sistema (baixa, transferência ou ajuste) com o mesmo valor assinado.
--   Ligar/desligar nunca move dinheiro; criar lançamento ou baixar a partir da
--   linha só acontece por ação explícita do usuário.
-- * Regras de categorização (texto, direção, conta, faixa de valor) usadas
--   como SUGESTÃO no extrato e no formulário de lançamento.
-- * Recorrências: geram PREVISÕES (sem efeito no razão) até um horizonte.
-- =============================================================================

-- Normalização de texto para comparação (minúsculas, sem acentos, espaços simples).
create or replace function public.fin_normalize(p_text text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(translate(coalesce(p_text, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'));
$$;

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.fin_bank_imports (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  account_id             uuid not null references public.fin_accounts (id),
  file_name              text not null,
  file_format            text not null check (file_format in ('ofx', 'csv')),
  file_hash              text,
  period_start           date,
  period_end             date,
  statement_balance      numeric(18, 2),
  statement_balance_date date,
  lines_total            integer not null default 0,
  lines_inserted         integer not null default 0,
  lines_duplicated       integer not null default 0,
  created_by             uuid references public.profiles (id),
  created_at             timestamptz not null default now()
);
create index if not exists fin_bank_imports_account_idx on public.fin_bank_imports (account_id, created_at desc);

create table if not exists public.fin_statement_lines (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  account_id            uuid not null references public.fin_accounts (id),
  import_id             uuid not null references public.fin_bank_imports (id),
  external_id           text not null check (length(external_id) between 1 and 200),
  posted_on             date not null,
  amount                numeric(18, 2) not null check (amount <> 0),
  description           text not null,
  memo                  text,
  document_number       text,
  status                text not null default 'pending' check (status in ('pending', 'matched', 'ignored')),
  matched_entry_id      uuid references public.fin_entries (id),
  matched_settlement_id uuid references public.fin_settlements (id),
  matched_by            uuid references public.profiles (id),
  matched_at            timestamptz,
  ignore_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint fin_statement_lines_match_ck check (
    (status = 'matched') = (matched_entry_id is not null)
    and (matched_settlement_id is null or matched_entry_id is not null)
    and (status <> 'ignored' or ignore_reason is not null)
  )
);
-- Idempotência: a mesma transação nunca entra duas vezes na mesma conta.
create unique index if not exists fin_statement_lines_external_uidx
  on public.fin_statement_lines (account_id, external_id);
-- Um movimento do sistema concilia com no máximo uma linha.
create unique index if not exists fin_statement_lines_settlement_uidx
  on public.fin_statement_lines (matched_settlement_id)
  where status = 'matched' and matched_settlement_id is not null;
create unique index if not exists fin_statement_lines_movement_uidx
  on public.fin_statement_lines (account_id, matched_entry_id)
  where status = 'matched' and matched_settlement_id is null;
create index if not exists fin_statement_lines_account_idx
  on public.fin_statement_lines (account_id, status, posted_on);
create index if not exists fin_statement_lines_entry_idx
  on public.fin_statement_lines (matched_entry_id) where matched_entry_id is not null;

create table if not exists public.fin_rules (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  name               text not null check (length(btrim(name)) > 0),
  is_active          boolean not null default true,
  priority           integer not null default 100,
  match_direction    text not null default 'any' check (match_direction in ('income', 'expense', 'any')),
  match_mode         text not null default 'contains' check (match_mode in ('contains', 'starts_with', 'equals')),
  match_text         text not null check (length(btrim(match_text)) >= 2),
  match_account_id   uuid references public.fin_accounts (id),
  amount_min         numeric(18, 2) check (amount_min is null or amount_min >= 0),
  amount_max         numeric(18, 2) check (amount_max is null or amount_max >= 0),
  category_id        uuid not null references public.fin_categories (id),
  counterparty_id    uuid references public.fin_counterparties (id),
  cost_center_id     uuid references public.fin_cost_centers (id),
  description_template text,
  times_applied      integer not null default 0,
  last_applied_at    timestamptz,
  created_by         uuid references public.profiles (id),
  updated_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fin_rules_amount_range_ck check (amount_min is null or amount_max is null or amount_min <= amount_max)
);
create index if not exists fin_rules_org_idx on public.fin_rules (organization_id, priority) where is_active;

create table if not exists public.fin_recurrences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('income', 'expense')),
  description      text not null check (length(btrim(description)) > 0),
  amount           numeric(18, 2) not null check (amount > 0),
  category_id      uuid not null references public.fin_categories (id),
  account_id       uuid references public.fin_accounts (id),
  counterparty_id  uuid references public.fin_counterparties (id),
  cost_center_id   uuid references public.fin_cost_centers (id),
  property_id      uuid references public.fin_properties (id),
  payment_method   text check (payment_method in (
                     'pix', 'ted', 'boleto', 'cartao_credito', 'cartao_debito',
                     'dinheiro', 'cheque', 'debito_automatico', 'outro'
                   )),
  frequency        text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'yearly')),
  start_date       date not null,
  end_date         date,
  forecast_until  date,
  is_active        boolean not null default true,
  notes            text,
  created_by       uuid references public.profiles (id),
  updated_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fin_recurrences_period_ck check (end_date is null or end_date >= start_date)
);

alter table public.fin_entries add column if not exists recurrence_id uuid references public.fin_recurrences (id);
create index if not exists fin_entries_recurrence_idx on public.fin_entries (recurrence_id) where recurrence_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Triggers padrão e RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_statement_lines', 'fin_rules', 'fin_recurrences']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;

  -- Linhas do extrato: auditoria só das mudanças (conciliar, ignorar), não da importação em massa.
  execute 'drop trigger if exists fin_statement_lines_audit on public.fin_statement_lines';
  execute 'create trigger fin_statement_lines_audit after update on public.fin_statement_lines
             for each row execute function public.audit_row_change()';

  foreach t in array array['fin_bank_imports', 'fin_rules', 'fin_recurrences']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t || '_audit', t
    );
  end loop;

  foreach t in array array['fin_bank_imports', 'fin_statement_lines', 'fin_rules', 'fin_recurrences']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.fin_can(organization_id, ''view''))',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.fin_can(organization_id, ''write'') and public.fin_rpc_context())',
      t || '_insert', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.fin_can(organization_id, ''write''))
         with check (public.fin_can(organization_id, ''write'') and public.fin_rpc_context())',
      t || '_update', t
    );
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;

-- Estorno de baixa ou cancelamento/alteração de valor desfaz a conciliação ligada.
create or replace function public.fin_unmatch_on_settlement_reversal()
returns trigger
language plpgsql
as $$
begin
  if new.reversed_at is not null and old.reversed_at is null then
    update public.fin_statement_lines
       set status = 'pending', matched_entry_id = null, matched_settlement_id = null,
           matched_by = null, matched_at = null
     where matched_settlement_id = new.id and status = 'matched';
  end if;
  return null;
end;
$$;

drop trigger if exists fin_settlements_unmatch on public.fin_settlements;
create trigger fin_settlements_unmatch
  after update of reversed_at on public.fin_settlements
  for each row execute function public.fin_unmatch_on_settlement_reversal();

create or replace function public.fin_unmatch_on_entry_change()
returns trigger
language plpgsql
as $$
begin
  if (new.cancelled_at is not null and old.cancelled_at is null)
     or (new.kind in ('transfer', 'adjustment') and (
          new.amount <> old.amount
          or new.account_id is distinct from old.account_id
          or new.transfer_account_id is distinct from old.transfer_account_id
          or new.adjustment_direction is distinct from old.adjustment_direction)) then
    update public.fin_statement_lines
       set status = 'pending', matched_entry_id = null, matched_settlement_id = null,
           matched_by = null, matched_at = null
     where matched_entry_id = new.id and matched_settlement_id is null and status = 'matched';
  end if;
  return null;
end;
$$;

drop trigger if exists fin_entries_unmatch on public.fin_entries;
create trigger fin_entries_unmatch
  after update on public.fin_entries
  for each row execute function public.fin_unmatch_on_entry_change();

-- -----------------------------------------------------------------------------
-- 3. Movimentos de caixa de uma conta (o que pode ser conciliado)
-- -----------------------------------------------------------------------------
create or replace function public.fin_account_movements(p_account_id uuid)
returns table (
  entry_id          uuid,
  settlement_id     uuid,
  movement_date     date,
  signed_amount     numeric,
  description       text,
  counterparty_name text,
  entry_kind        text,
  matched_line_id   uuid
)
language sql
stable
as $$
  -- Baixas de entradas e saídas
  select e.id, s.id, s.settled_on,
         case when e.kind = 'income' then s.amount else -s.amount end,
         e.description, cp.name, e.kind,
         (select l.id from public.fin_statement_lines l
           where l.matched_settlement_id = s.id and l.status = 'matched' limit 1)
  from public.fin_settlements s
  join public.fin_entries e on e.id = s.entry_id
  left join public.fin_counterparties cp on cp.id = e.counterparty_id
  where s.account_id = p_account_id
    and s.organization_id = public.app_current_org()
    and s.reversed_at is null
  union all
  -- Transferências que saem desta conta
  select e.id, null, e.competence_date, -e.amount, e.description, null, e.kind,
         (select l.id from public.fin_statement_lines l
           where l.matched_entry_id = e.id and l.matched_settlement_id is null
             and l.account_id = p_account_id and l.status = 'matched' limit 1)
  from public.fin_entries e
  where e.kind = 'transfer' and e.account_id = p_account_id
    and e.organization_id = public.app_current_org() and e.cancelled_at is null
  union all
  -- Transferências que entram nesta conta
  select e.id, null, e.competence_date, e.amount, e.description, null, e.kind,
         (select l.id from public.fin_statement_lines l
           where l.matched_entry_id = e.id and l.matched_settlement_id is null
             and l.account_id = p_account_id and l.status = 'matched' limit 1)
  from public.fin_entries e
  where e.kind = 'transfer' and e.transfer_account_id = p_account_id
    and e.organization_id = public.app_current_org() and e.cancelled_at is null
  union all
  -- Ajustes de saldo (o saldo inicial não é transação bancária)
  select e.id, null, e.competence_date,
         case when e.adjustment_direction = 'increase' then e.amount else -e.amount end,
         e.description, null, e.kind,
         (select l.id from public.fin_statement_lines l
           where l.matched_entry_id = e.id and l.matched_settlement_id is null
             and l.account_id = p_account_id and l.status = 'matched' limit 1)
  from public.fin_entries e
  where e.kind = 'adjustment' and e.account_id = p_account_id and e.origin <> 'opening_balance'
    and e.organization_id = public.app_current_org() and e.cancelled_at is null;
$$;

-- -----------------------------------------------------------------------------
-- 4. Regras
-- -----------------------------------------------------------------------------
create or replace function public.fin_match_rule(
  p_org         uuid,
  p_direction   text,
  p_text        text,
  p_amount      numeric,
  p_account_id  uuid
)
returns public.fin_rules
language sql
stable
as $$
  select r.*
  from public.fin_rules r
  join public.fin_categories c on c.id = r.category_id and c.is_active
  where r.organization_id = p_org
    and r.is_active
    and (r.match_direction = 'any' or r.match_direction = p_direction)
    and (public.fin_nature_direction(c.nature) = 'both' or public.fin_nature_direction(c.nature) = p_direction)
    and (r.match_account_id is null or r.match_account_id = p_account_id)
    and (r.amount_min is null or p_amount is null or abs(p_amount) >= r.amount_min)
    and (r.amount_max is null or p_amount is null or abs(p_amount) <= r.amount_max)
    and case r.match_mode
          when 'equals'      then public.fin_normalize(p_text) = public.fin_normalize(r.match_text)
          when 'starts_with' then public.fin_normalize(p_text) like public.fin_normalize(r.match_text) || '%'
          else position(public.fin_normalize(r.match_text) in public.fin_normalize(p_text)) > 0
        end
  order by r.priority, r.created_at
  limit 1;
$$;

create or replace function public.app_fin_save_rule(
  p_payload  jsonb,
  p_rule_id  uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org      uuid := public.fin_require('write');
  v_profile  uuid := public.current_profile_id();
  v_id       uuid;
  v_category uuid := nullif(p_payload ->> 'category_id', '')::uuid;
  v_dir      text := coalesce(nullif(p_payload ->> 'match_direction', ''), 'any');
  v_nature   text;
begin
  perform public.set_audit_metadata(p_metadata);

  if length(btrim(coalesce(p_payload ->> 'name', ''))) = 0 then
    raise exception 'Dê um nome à regra.' using errcode = 'CF002';
  end if;
  if length(btrim(coalesce(p_payload ->> 'match_text', ''))) < 2 then
    raise exception 'Informe o texto a procurar (ao menos 2 caracteres).' using errcode = 'CF002';
  end if;
  select nature into v_nature from public.fin_categories where id = v_category and organization_id = v_org;
  if v_nature is null then
    raise exception 'Selecione a categoria que a regra aplica.' using errcode = 'CF002';
  end if;
  if v_dir <> 'any' and public.fin_nature_direction(v_nature) not in ('both', v_dir) then
    raise exception 'A categoria escolhida não combina com a direção da regra.' using errcode = 'CF002';
  end if;
  perform public.fin_assert_owned('fin_accounts', nullif(p_payload ->> 'match_account_id', '')::uuid, v_org, 'Conta');
  perform public.fin_assert_owned('fin_counterparties', nullif(p_payload ->> 'counterparty_id', '')::uuid, v_org, 'Favorecido');
  perform public.fin_assert_owned('fin_cost_centers', nullif(p_payload ->> 'cost_center_id', '')::uuid, v_org, 'Centro de custo');
  if nullif(p_payload ->> 'amount_min', '')::numeric > nullif(p_payload ->> 'amount_max', '')::numeric then
    raise exception 'O valor mínimo não pode ser maior que o máximo.' using errcode = 'CF002';
  end if;

  if p_rule_id is null then
    insert into public.fin_rules (
      organization_id, name, is_active, priority, match_direction, match_mode, match_text,
      match_account_id, amount_min, amount_max, category_id, counterparty_id, cost_center_id,
      description_template, created_by, updated_by
    )
    values (
      v_org, btrim(p_payload ->> 'name'), coalesce((p_payload ->> 'is_active')::boolean, true),
      coalesce(nullif(p_payload ->> 'priority', '')::integer, 100), v_dir,
      coalesce(nullif(p_payload ->> 'match_mode', ''), 'contains'), btrim(p_payload ->> 'match_text'),
      nullif(p_payload ->> 'match_account_id', '')::uuid,
      round(nullif(p_payload ->> 'amount_min', '')::numeric, 2),
      round(nullif(p_payload ->> 'amount_max', '')::numeric, 2),
      v_category, nullif(p_payload ->> 'counterparty_id', '')::uuid, nullif(p_payload ->> 'cost_center_id', '')::uuid,
      nullif(btrim(coalesce(p_payload ->> 'description_template', '')), ''), v_profile, v_profile
    )
    returning id into v_id;
  else
    update public.fin_rules
       set name = btrim(p_payload ->> 'name'),
           is_active = coalesce((p_payload ->> 'is_active')::boolean, is_active),
           priority = coalesce(nullif(p_payload ->> 'priority', '')::integer, priority),
           match_direction = v_dir,
           match_mode = coalesce(nullif(p_payload ->> 'match_mode', ''), 'contains'),
           match_text = btrim(p_payload ->> 'match_text'),
           match_account_id = nullif(p_payload ->> 'match_account_id', '')::uuid,
           amount_min = round(nullif(p_payload ->> 'amount_min', '')::numeric, 2),
           amount_max = round(nullif(p_payload ->> 'amount_max', '')::numeric, 2),
           category_id = v_category,
           counterparty_id = nullif(p_payload ->> 'counterparty_id', '')::uuid,
           cost_center_id = nullif(p_payload ->> 'cost_center_id', '')::uuid,
           description_template = nullif(btrim(coalesce(p_payload ->> 'description_template', '')), ''),
           updated_by = v_profile
     where id = p_rule_id and organization_id = v_org
    returning id into v_id;
    if v_id is null then
      raise exception 'Regra não encontrada.' using errcode = 'CF005';
    end if;
  end if;
  return v_id;
end;
$$;

-- Sugestão de categoria: regras primeiro, depois histórico (substitui a da 0010).
create or replace function public.fin_suggest_category(
  p_kind            text,
  p_description     text,
  p_counterparty_id uuid default null
)
returns table (category_id uuid, category_name text, matches integer, reason text)
language sql
stable
as $$
  with rule as (
    select r.category_id, c.name, r.name as rule_name
    from public.fin_match_rule(public.app_current_org(), p_kind, p_description, null, null) r
    join public.fin_categories c on c.id = r.category_id
    where r.id is not null and length(btrim(coalesce(p_description, ''))) >= 2
  ),
  candidates as (
    select
      e.category_id,
      c.name,
      (p_counterparty_id is not null and e.counterparty_id = p_counterparty_id) as by_counterparty,
      (case when p_counterparty_id is not null and e.counterparty_id = p_counterparty_id then 2 else 0 end
        + case when similarity(lower(e.description), lower(coalesce(p_description, ''))) >= 0.35 then 1 else 0 end) as score
    from public.fin_entries e
    join public.fin_categories c on c.id = e.category_id
    where e.organization_id = public.app_current_org()
      and e.kind = p_kind
      and e.cancelled_at is null
      and e.origin in ('manual', 'import')
      and c.is_active
      and (
        (p_counterparty_id is not null and e.counterparty_id = p_counterparty_id)
        or (length(btrim(coalesce(p_description, ''))) >= 3
            and similarity(lower(e.description), lower(p_description)) >= 0.35)
      )
  ),
  history as (
    select
      category_id,
      name,
      count(*)::integer as matches,
      case
        when bool_or(by_counterparty) then 'Usada com este favorecido em ' || count(*) || ' lançamento(s) anterior(es).'
        else 'Usada em ' || count(*) || ' lançamento(s) com descrição parecida.'
      end as reason,
      sum(score) as score
    from candidates
    group by category_id, name
    order by sum(score) desc, count(*) desc
    limit 1
  )
  select s.category_id, s.name, s.matches, s.reason from (
    select category_id, name, 0 as matches, 'Regra "' || rule_name || '".' as reason, 0 as ord from rule
    union all
    select category_id, name, matches, reason, 1 from history
  ) s
  order by s.ord
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 5. Importação de extrato
-- -----------------------------------------------------------------------------
create or replace function public.app_fin_import_statement(
  p_account_id uuid,
  p_payload    jsonb,
  p_metadata   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_org      uuid := public.fin_require('write');
  v_import   uuid;
  v_total    integer := coalesce(jsonb_array_length(p_payload -> 'lines'), 0);
  v_inserted integer;
  v_format   text := p_payload ->> 'format';
begin
  perform public.set_audit_metadata(p_metadata);
  perform public.fin_assert_owned('fin_accounts', p_account_id, v_org, 'Conta');
  if p_account_id is null then
    raise exception 'Escolha a conta do extrato.' using errcode = 'CF002';
  end if;
  if v_format not in ('ofx', 'csv') then
    raise exception 'Formato de arquivo não suportado.' using errcode = 'CF002';
  end if;
  if v_total = 0 then
    raise exception 'O arquivo não tem transações.' using errcode = 'CF002';
  end if;
  if v_total > 5000 then
    raise exception 'Importe no máximo 5.000 transações por arquivo.' using errcode = 'CF002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_payload -> 'lines') as l(external_id text, posted_on date, amount numeric)
    where l.external_id is null or l.posted_on is null or l.amount is null or round(l.amount, 2) = 0
  ) then
    raise exception 'Há transações sem data, sem valor ou sem identificador no arquivo.' using errcode = 'CF002';
  end if;

  insert into public.fin_bank_imports (
    organization_id, account_id, file_name, file_format, file_hash, period_start, period_end,
    statement_balance, statement_balance_date, lines_total, created_by
  )
  values (
    v_org, p_account_id, coalesce(nullif(btrim(p_payload ->> 'file_name'), ''), 'extrato'), v_format,
    nullif(p_payload ->> 'file_hash', ''),
    nullif(p_payload ->> 'period_start', '')::date, nullif(p_payload ->> 'period_end', '')::date,
    round(nullif(p_payload ->> 'statement_balance', '')::numeric, 2),
    nullif(p_payload ->> 'statement_balance_date', '')::date,
    v_total, public.current_profile_id()
  )
  returning id into v_import;

  insert into public.fin_statement_lines (
    organization_id, account_id, import_id, external_id, posted_on, amount, description, memo, document_number
  )
  select v_org, p_account_id, v_import, left(l.external_id, 200), l.posted_on, public.fin_money(l.amount),
         coalesce(nullif(btrim(l.description), ''), 'Sem descrição'),
         nullif(btrim(coalesce(l.memo, '')), ''), nullif(btrim(coalesce(l.document_number, '')), '')
  from jsonb_to_recordset(p_payload -> 'lines')
       as l(external_id text, posted_on date, amount numeric, description text, memo text, document_number text)
  on conflict (account_id, external_id) do nothing;
  get diagnostics v_inserted = row_count;

  update public.fin_bank_imports
     set lines_inserted = v_inserted, lines_duplicated = v_total - v_inserted
   where id = v_import;

  return jsonb_build_object(
    'import_id', v_import, 'total', v_total, 'inserted', v_inserted, 'duplicated', v_total - v_inserted
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Candidatos e sugestões de conciliação
-- -----------------------------------------------------------------------------
create or replace function public.fin_line_candidates(p_line_id uuid)
returns table (
  candidate_type    text,      -- 'movement' (já no caixa) | 'open_entry' (título a baixar)
  entry_id          uuid,
  settlement_id     uuid,
  ref_date          date,
  amount            numeric,
  remaining         numeric,
  description       text,
  counterparty_name text,
  day_diff          integer,
  exact             boolean
)
language sql
stable
as $$
  with line as (
    select * from public.fin_statement_lines
    where id = p_line_id and organization_id = public.app_current_org()
  )
  select * from (
    select 'movement'::text, m.entry_id, m.settlement_id, m.movement_date, m.signed_amount, 0::numeric,
           m.description, m.counterparty_name, abs(m.movement_date - line.posted_on), true
    from line, public.fin_account_movements(line.account_id) m
    where m.matched_line_id is null
      and m.signed_amount = line.amount
      and abs(m.movement_date - line.posted_on) <= 10
    union all
    select 'open_entry'::text, e.id, null, coalesce(e.due_date, e.competence_date), e.amount,
           e.amount - e.settled_amount, e.description, cp.name,
           abs(coalesce(e.due_date, e.competence_date) - line.posted_on),
           (e.amount - e.settled_amount) = abs(line.amount)
    from line
    join public.fin_entries e
      on e.organization_id = line.organization_id
     and e.kind = case when line.amount > 0 then 'income' else 'expense' end
     and e.status in ('open', 'partial', 'forecast')
     and (e.account_id is null or e.account_id = line.account_id)
     and e.amount - e.settled_amount >= abs(line.amount)
     and abs(coalesce(e.due_date, e.competence_date) - line.posted_on) <= 45
    left join public.fin_counterparties cp on cp.id = e.counterparty_id
  ) c (candidate_type, entry_id, settlement_id, ref_date, amount, remaining, description, counterparty_name, day_diff, exact)
  order by case candidate_type when 'movement' then 0 else 1 end, exact desc, day_diff
  limit 30;
$$;

-- Pares inequívocos: mesmo valor, até 3 dias de diferença, um único candidato
-- de cada lado. São apenas sugestões; o usuário confirma.
create or replace function public.fin_reconciliation_suggestions(p_account_id uuid)
returns table (line_id uuid, entry_id uuid, settlement_id uuid, description text, day_diff integer)
language sql
stable
as $$
  with pairs as (
    select l.id as line_id, m.entry_id, m.settlement_id, m.description,
           abs(m.movement_date - l.posted_on) as day_diff,
           coalesce(m.settlement_id, m.entry_id) as movement_key
    from public.fin_statement_lines l
    join public.fin_account_movements(p_account_id) m
      on m.matched_line_id is null
     and m.signed_amount = l.amount
     and abs(m.movement_date - l.posted_on) <= 3
    where l.account_id = p_account_id
      and l.organization_id = public.app_current_org()
      and l.status = 'pending'
  ),
  unique_pairs as (
    select p.*,
           count(*) over (partition by p.line_id) as per_line,
           count(*) over (partition by p.movement_key) as per_movement
    from pairs p
  )
  select line_id, entry_id, settlement_id, description, day_diff::integer
  from unique_pairs
  where per_line = 1 and per_movement = 1;
$$;

-- Lista de linhas com a sugestão (movimento ou regra) para a tela.
create or replace function public.fin_statement_lines_list(p_account_id uuid, p_status text default 'pending')
returns table (
  id                       uuid,
  import_id                uuid,
  posted_on                date,
  amount                   numeric,
  description              text,
  memo                     text,
  document_number          text,
  status                   text,
  ignore_reason            text,
  matched_entry_id         uuid,
  matched_settlement_id    uuid,
  matched_description      text,
  matched_at               timestamptz,
  suggested_entry_id       uuid,
  suggested_settlement_id  uuid,
  suggested_description    text,
  suggested_day_diff       integer,
  rule_id                  uuid,
  rule_name                text,
  rule_category_id         uuid,
  rule_category_name       text
)
language sql
stable
as $$
  with s as (select * from public.fin_reconciliation_suggestions(p_account_id))
  select l.id, l.import_id, l.posted_on, l.amount, l.description, l.memo, l.document_number,
         l.status, l.ignore_reason, l.matched_entry_id, l.matched_settlement_id, me.description, l.matched_at,
         s.entry_id, s.settlement_id, s.description, s.day_diff,
         r.id, r.name, r.category_id, rc.name
  from public.fin_statement_lines l
  left join public.fin_entries me on me.id = l.matched_entry_id
  left join s on s.line_id = l.id
  left join lateral (
    select * from public.fin_match_rule(
      l.organization_id, case when l.amount > 0 then 'income' else 'expense' end,
      l.description || ' ' || coalesce(l.memo, ''), l.amount, l.account_id)
  ) r on l.status = 'pending' and s.line_id is null
  left join public.fin_categories rc on rc.id = r.category_id
  where l.account_id = p_account_id
    and l.organization_id = public.app_current_org()
    and (p_status = 'all' or l.status = p_status)
  order by l.posted_on desc, l.created_at desc
  limit 1000;
$$;

create or replace function public.fin_reconciliation_summary(p_account_id uuid)
returns table (
  ledger_balance             numeric,
  statement_balance          numeric,
  statement_balance_date     date,
  ledger_balance_at_statement numeric,
  difference                 numeric,
  pending_lines              integer,
  pending_in                 numeric,
  pending_out                numeric,
  matched_lines              integer,
  ignored_lines              integer,
  first_line_date            date,
  last_line_date             date,
  unmatched_movements        integer,
  suggestions                integer,
  last_import_at             timestamptz
)
language sql
stable
as $$
  with acc as (
    select id from public.fin_accounts where id = p_account_id and organization_id = public.app_current_org()
  ),
  stmt as (
    select i.statement_balance, i.statement_balance_date
    from public.fin_bank_imports i, acc
    where i.account_id = acc.id and i.statement_balance is not null and i.statement_balance_date is not null
    order by i.statement_balance_date desc, i.created_at desc
    limit 1
  ),
  lines as (
    select
      count(*) filter (where status = 'pending')::integer as pending_lines,
      coalesce(sum(amount) filter (where status = 'pending' and amount > 0), 0) as pending_in,
      coalesce(-sum(amount) filter (where status = 'pending' and amount < 0), 0) as pending_out,
      count(*) filter (where status = 'matched')::integer as matched_lines,
      count(*) filter (where status = 'ignored')::integer as ignored_lines,
      min(posted_on) as first_line_date,
      max(posted_on) as last_line_date
    from public.fin_statement_lines l, acc where l.account_id = acc.id
  )
  select
    (select coalesce(sum(p.amount), 0) from public.fin_postings p, acc
      where p.account_id = acc.id and p.bucket = 'cash' and p.posting_date <= public.fin_today()),
    stmt.statement_balance,
    stmt.statement_balance_date,
    case when stmt.statement_balance_date is null then null else
      (select coalesce(sum(p.amount), 0) from public.fin_postings p, acc
        where p.account_id = acc.id and p.bucket = 'cash' and p.posting_date <= stmt.statement_balance_date) end,
    case when stmt.statement_balance_date is null then null else
      stmt.statement_balance - (select coalesce(sum(p.amount), 0) from public.fin_postings p, acc
        where p.account_id = acc.id and p.bucket = 'cash' and p.posting_date <= stmt.statement_balance_date) end,
    lines.pending_lines, lines.pending_in, lines.pending_out, lines.matched_lines, lines.ignored_lines,
    lines.first_line_date, lines.last_line_date,
    (select count(*)::integer from public.fin_account_movements(p_account_id) m
      where m.matched_line_id is null
        and lines.first_line_date is not null
        and m.movement_date between lines.first_line_date and lines.last_line_date),
    (select count(*)::integer from public.fin_reconciliation_suggestions(p_account_id)),
    (select max(created_at) from public.fin_bank_imports i, acc where i.account_id = acc.id)
  from acc
  cross join lines
  left join stmt on true;
$$;

-- -----------------------------------------------------------------------------
-- 7. Ações de conciliação
-- -----------------------------------------------------------------------------
create or replace function public.fin_lock_pending_line(p_line_id uuid, p_org uuid)
returns public.fin_statement_lines
language plpgsql
as $$
declare
  v_line public.fin_statement_lines%rowtype;
begin
  select * into v_line from public.fin_statement_lines
  where id = p_line_id and organization_id = p_org for update;
  if not found then
    raise exception 'Linha do extrato não encontrada.' using errcode = 'CF005';
  end if;
  if v_line.status <> 'pending' then
    raise exception 'Esta linha do extrato já foi conciliada ou ignorada.' using errcode = 'CF003';
  end if;
  return v_line;
end;
$$;

create or replace function public.fin_set_line_matched(p_line_id uuid, p_entry_id uuid, p_settlement_id uuid)
returns void
language plpgsql
as $$
declare
  v_line public.fin_statement_lines%rowtype;
  v_ok   boolean;
begin
  select * into v_line from public.fin_statement_lines where id = p_line_id;
  select exists (
    select 1 from public.fin_account_movements(v_line.account_id) m
    where m.entry_id = p_entry_id
      and m.settlement_id is not distinct from p_settlement_id
      and m.matched_line_id is null
      and m.signed_amount = v_line.amount
  ) into v_ok;
  if not v_ok then
    raise exception 'O movimento escolhido não tem o mesmo valor desta linha ou já está conciliado.'
      using errcode = 'CF002';
  end if;

  update public.fin_statement_lines
     set status = 'matched', matched_entry_id = p_entry_id, matched_settlement_id = p_settlement_id,
         matched_by = public.current_profile_id(), matched_at = now(), ignore_reason = null
   where id = p_line_id;
end;
$$;

-- Liga a linha a um movimento que já está no caixa.
create or replace function public.app_fin_match_line(
  p_line_id       uuid,
  p_entry_id      uuid,
  p_settlement_id uuid default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(p_metadata);
  perform public.fin_lock_pending_line(p_line_id, v_org);
  perform public.fin_set_line_matched(p_line_id, p_entry_id, p_settlement_id);
end;
$$;

-- Confirma de uma vez as sugestões inequívocas da conta (ação explícita do usuário).
create or replace function public.app_fin_confirm_suggestions(
  p_account_id uuid,
  p_line_ids   uuid[] default null,
  p_metadata   jsonb default '{}'::jsonb
)
returns integer
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_row   record;
  v_count integer := 0;
begin
  perform public.set_audit_metadata(p_metadata);
  perform public.fin_assert_owned('fin_accounts', p_account_id, v_org, 'Conta');
  for v_row in select * from public.fin_reconciliation_suggestions(p_account_id) loop
    if p_line_ids is null or v_row.line_id = any (p_line_ids) then
      perform public.fin_lock_pending_line(v_row.line_id, v_org);
      perform public.fin_set_line_matched(v_row.line_id, v_row.entry_id, v_row.settlement_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Registra a baixa de um título em aberto usando a linha do extrato.
create or replace function public.app_fin_settle_from_line(
  p_line_id  uuid,
  p_entry_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org        uuid := public.fin_require('write');
  v_line       public.fin_statement_lines%rowtype;
  v_entry      public.fin_entries%rowtype;
  v_settlement uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  v_line := public.fin_lock_pending_line(p_line_id, v_org);

  select * into v_entry from public.fin_entries where id = p_entry_id and organization_id = v_org;
  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
  end if;
  if v_entry.kind <> (case when v_line.amount > 0 then 'income' else 'expense' end) then
    raise exception '%', case when v_line.amount > 0
      then 'Uma entrada no extrato só pode baixar uma conta a receber.'
      else 'Uma saída no extrato só pode baixar uma conta a pagar.' end
      using errcode = 'CF002';
  end if;

  v_settlement := public.fin_insert_settlement(
    v_entry.id, v_line.account_id, v_line.posted_on, abs(v_line.amount), null,
    'Baixa pela conciliação bancária'
  );
  perform public.fin_set_line_matched(v_line.id, v_entry.id, v_settlement);
  return v_settlement;
end;
$$;

-- Cria o lançamento (já realizado) a partir da linha e concilia.
create or replace function public.fin_create_from_line_internal(
  p_line    public.fin_statement_lines,
  p_payload jsonb,
  p_metadata jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_kind       text := coalesce(nullif(p_payload ->> 'kind', ''), case when p_line.amount > 0 then 'income' else 'expense' end);
  v_ids        uuid[];
  v_settlement uuid;
  v_other      uuid := nullif(p_payload ->> 'other_account_id', '')::uuid;
  v_rule       uuid := nullif(p_payload ->> 'rule_id', '')::uuid;
  v_desc       text := coalesce(nullif(btrim(p_payload ->> 'description'), ''), p_line.description);
begin
  if v_kind = 'transfer' then
    if v_other is null or v_other = p_line.account_id then
      raise exception 'Escolha a outra conta da transferência.' using errcode = 'CF002';
    end if;
    v_ids := public.app_fin_save_entry(
      jsonb_build_object(
        'kind', 'transfer', 'description', v_desc, 'amount', abs(p_line.amount),
        'account_id', case when p_line.amount < 0 then p_line.account_id else v_other end,
        'transfer_account_id', case when p_line.amount < 0 then v_other else p_line.account_id end,
        'competence_date', p_line.posted_on, 'notes', p_payload ->> 'notes'
      ),
      null, p_metadata
    );
    update public.fin_entries set origin = 'import' where id = v_ids[1];
    perform public.fin_set_line_matched(p_line.id, v_ids[1], null);
    return v_ids[1];
  end if;

  if v_kind <> (case when p_line.amount > 0 then 'income' else 'expense' end) then
    raise exception '%', case when p_line.amount > 0
      then 'Uma entrada no extrato gera um lançamento de entrada.'
      else 'Uma saída no extrato gera um lançamento de saída.' end
      using errcode = 'CF002';
  end if;

  v_ids := public.app_fin_save_entry(
    jsonb_build_object(
      'kind', v_kind, 'description', v_desc, 'amount', abs(p_line.amount),
      'category_id', p_payload ->> 'category_id',
      'counterparty_id', p_payload ->> 'counterparty_id',
      'cost_center_id', p_payload ->> 'cost_center_id',
      'property_id', p_payload ->> 'property_id',
      'account_id', p_line.account_id,
      'competence_date', coalesce(nullif(p_payload ->> 'competence_date', ''), p_line.posted_on::text),
      'document_number', coalesce(p_payload ->> 'document_number', p_line.document_number),
      'notes', p_payload ->> 'notes',
      'settle_now', true,
      'settlement_account_id', p_line.account_id,
      'settled_on', p_line.posted_on
    ),
    null, p_metadata
  );
  update public.fin_entries set origin = 'import' where id = v_ids[1];
  select id into v_settlement from public.fin_settlements where entry_id = v_ids[1] and reversed_at is null;
  perform public.fin_set_line_matched(p_line.id, v_ids[1], v_settlement);

  if v_rule is not null then
    update public.fin_rules set times_applied = times_applied + 1, last_applied_at = now()
    where id = v_rule and organization_id = p_line.organization_id;
  end if;
  return v_ids[1];
end;
$$;

create or replace function public.app_fin_create_from_line(
  p_line_id  uuid,
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org  uuid := public.fin_require('write');
  v_line public.fin_statement_lines%rowtype;
begin
  perform public.set_audit_metadata(p_metadata);
  v_line := public.fin_lock_pending_line(p_line_id, v_org);
  return public.fin_create_from_line_internal(v_line, p_payload, p_metadata);
end;
$$;

-- Cria lançamentos para as linhas escolhidas usando a regra de cada uma.
create or replace function public.app_fin_create_from_rules(
  p_line_ids uuid[],
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_id    uuid;
  v_line  public.fin_statement_lines%rowtype;
  v_rule  public.fin_rules%rowtype;
  v_count integer := 0;
begin
  perform public.set_audit_metadata(p_metadata);
  if coalesce(array_length(p_line_ids, 1), 0) > 500 then
    raise exception 'Selecione no máximo 500 linhas por vez.' using errcode = 'CF002';
  end if;
  foreach v_id in array coalesce(p_line_ids, array[]::uuid[]) loop
    select * into v_line from public.fin_statement_lines
    where id = v_id and organization_id = v_org and status = 'pending' for update;
    if not found then
      continue;
    end if;
    v_rule := public.fin_match_rule(
      v_org, case when v_line.amount > 0 then 'income' else 'expense' end,
      v_line.description || ' ' || coalesce(v_line.memo, ''), v_line.amount, v_line.account_id
    );
    if v_rule.id is null then
      continue;
    end if;
    perform public.fin_create_from_line_internal(
      v_line,
      jsonb_build_object(
        'category_id', v_rule.category_id, 'counterparty_id', v_rule.counterparty_id,
        'cost_center_id', v_rule.cost_center_id, 'description', coalesce(v_rule.description_template, v_line.description),
        'rule_id', v_rule.id, 'notes', 'Criado pela regra "' || v_rule.name || '" a partir do extrato.'
      ),
      p_metadata
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.app_fin_unmatch_line(p_line_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(p_metadata);
  update public.fin_statement_lines
     set status = 'pending', matched_entry_id = null, matched_settlement_id = null,
         matched_by = null, matched_at = null, ignore_reason = null
   where id = p_line_id and organization_id = v_org and status in ('matched', 'ignored');
  if not found then
    raise exception 'Linha não encontrada ou já pendente.' using errcode = 'CF005';
  end if;
end;
$$;

create or replace function public.app_fin_ignore_line(p_line_id uuid, p_reason text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Explique por que esta linha será ignorada (mínimo de 10 caracteres).' using errcode = 'CF002';
  end if;
  perform public.fin_lock_pending_line(p_line_id, v_org);
  update public.fin_statement_lines
     set status = 'ignored', ignore_reason = btrim(p_reason), matched_by = public.current_profile_id(), matched_at = now()
   where id = p_line_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Recorrências (geram previsões)
-- -----------------------------------------------------------------------------
create or replace function public.fin_recurrence_step(p_frequency text)
returns interval
language sql
immutable
as $$
  select case p_frequency when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' else interval '1 month' end;
$$;

create or replace function public.fin_generate_recurrence(p_recurrence_id uuid, p_until date)
returns integer
language plpgsql
as $$
declare
  v_rec   public.fin_recurrences%rowtype;
  v_date  date;
  v_n     integer := 0;
  v_count integer := 0;
  v_entry public.fin_entries%rowtype;
  v_limit date;
begin
  select * into v_rec from public.fin_recurrences where id = p_recurrence_id for update;
  if not found or not v_rec.is_active then
    return 0;
  end if;
  v_limit := least(p_until, coalesce(v_rec.end_date, p_until));

  loop
    -- Sempre a partir da data inicial: evita deriva de fim de mês (31 → 28 → 28...).
    v_date := (v_rec.start_date + public.fin_recurrence_step(v_rec.frequency) * v_n)::date;
    exit when v_date > v_limit or v_n > 600;
    if (v_rec.forecast_until is null or v_date > v_rec.forecast_until)
       and not exists (
         select 1 from public.fin_entries
         where recurrence_id = v_rec.id and competence_date = v_date and cancelled_at is null
       ) then
      insert into public.fin_entries (
        organization_id, kind, description, amount, category_id, account_id, counterparty_id,
        cost_center_id, property_id, payment_method, competence_date, due_date, is_forecast,
        notes, origin, recurrence_id, created_by, updated_by
      )
      values (
        v_rec.organization_id, v_rec.kind, v_rec.description, v_rec.amount, v_rec.category_id,
        v_rec.account_id, v_rec.counterparty_id, v_rec.cost_center_id, v_rec.property_id,
        v_rec.payment_method, v_date, v_date, true, v_rec.notes, 'recurrence', v_rec.id,
        public.current_profile_id(), public.current_profile_id()
      )
      returning * into v_entry;
      perform public.fin_validate_entry(v_entry);
      perform public.fin_refresh_entry(v_entry.id);
      v_count := v_count + 1;
    end if;
    v_n := v_n + 1;
  end loop;

  update public.fin_recurrences
     set forecast_until = greatest(coalesce(forecast_until, v_limit), v_limit)
   where id = v_rec.id;
  return v_count;
end;
$$;

-- Cancela previsões futuras ainda intocadas de uma recorrência (edição/encerramento).
create or replace function public.fin_cancel_future_forecasts(p_recurrence_id uuid, p_from date, p_reason text)
returns void
language plpgsql
as $$
begin
  update public.fin_entries
     set cancelled_at = now(), cancelled_by = public.current_profile_id(), cancel_reason = p_reason,
         status = 'cancelled'
   where recurrence_id = p_recurrence_id
     and status = 'forecast'
     and settled_amount = 0
     and competence_date >= p_from;
end;
$$;

create or replace function public.app_fin_save_recurrence(
  p_payload       jsonb,
  p_recurrence_id uuid default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org      uuid := public.fin_require('write');
  v_profile  uuid := public.current_profile_id();
  v_id       uuid;
  v_kind     text := p_payload ->> 'kind';
  v_amount   numeric := public.fin_money(nullif(p_payload ->> 'amount', '')::numeric);
  v_start    date := nullif(p_payload ->> 'start_date', '')::date;
  v_end      date := nullif(p_payload ->> 'end_date', '')::date;
  v_category uuid := nullif(p_payload ->> 'category_id', '')::uuid;
  v_nature   text;
  v_horizon  date := (public.fin_today() + coalesce(nullif(p_payload ->> 'horizon_days', '')::integer, 90))::date;
  v_today    date := public.fin_today();
begin
  perform public.set_audit_metadata(p_metadata);

  if v_kind not in ('income', 'expense') then
    raise exception 'Recorrências são de entrada ou de saída.' using errcode = 'CF002';
  end if;
  if length(btrim(coalesce(p_payload ->> 'description', ''))) = 0 then
    raise exception 'Informe a descrição.' using errcode = 'CF002';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe um valor maior que zero.' using errcode = 'CF002';
  end if;
  if v_start is null then
    raise exception 'Informe a data da primeira ocorrência.' using errcode = 'CF002';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'A data final deve ser depois da primeira ocorrência.' using errcode = 'CF002';
  end if;
  select nature into v_nature from public.fin_categories where id = v_category and organization_id = v_org;
  if v_nature is null then
    raise exception 'Selecione uma categoria.' using errcode = 'CF002';
  end if;
  if public.fin_nature_direction(v_nature) not in ('both', v_kind) then
    raise exception 'A categoria não combina com o tipo da recorrência.' using errcode = 'CF002';
  end if;

  if p_recurrence_id is null then
    insert into public.fin_recurrences (
      organization_id, kind, description, amount, category_id, account_id, counterparty_id, cost_center_id,
      property_id, payment_method, frequency, start_date, end_date, is_active, notes, created_by, updated_by
    )
    values (
      v_org, v_kind, btrim(p_payload ->> 'description'), v_amount, v_category,
      nullif(p_payload ->> 'account_id', '')::uuid, nullif(p_payload ->> 'counterparty_id', '')::uuid,
      nullif(p_payload ->> 'cost_center_id', '')::uuid, nullif(p_payload ->> 'property_id', '')::uuid,
      nullif(p_payload ->> 'payment_method', ''), coalesce(nullif(p_payload ->> 'frequency', ''), 'monthly'),
      v_start, v_end, coalesce((p_payload ->> 'is_active')::boolean, true),
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
    )
    returning id into v_id;
  else
    select id into v_id from public.fin_recurrences where id = p_recurrence_id and organization_id = v_org for update;
    if v_id is null then
      raise exception 'Recorrência não encontrada.' using errcode = 'CF005';
    end if;
    -- As previsões futuras intocadas são refeitas com os novos dados.
    perform public.fin_cancel_future_forecasts(v_id, v_today, 'Recorrência alterada');
    update public.fin_recurrences
       set kind = v_kind, description = btrim(p_payload ->> 'description'), amount = v_amount,
           category_id = v_category,
           account_id = nullif(p_payload ->> 'account_id', '')::uuid,
           counterparty_id = nullif(p_payload ->> 'counterparty_id', '')::uuid,
           cost_center_id = nullif(p_payload ->> 'cost_center_id', '')::uuid,
           property_id = nullif(p_payload ->> 'property_id', '')::uuid,
           payment_method = nullif(p_payload ->> 'payment_method', ''),
           frequency = coalesce(nullif(p_payload ->> 'frequency', ''), 'monthly'),
           start_date = v_start, end_date = v_end,
           is_active = coalesce((p_payload ->> 'is_active')::boolean, true),
           notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           forecast_until = case when forecast_until is null then null else least(forecast_until, v_today - 1) end,
           updated_by = v_profile
     where id = v_id;
  end if;

  perform public.fin_assert_owned('fin_accounts', nullif(p_payload ->> 'account_id', '')::uuid, v_org, 'Conta');
  perform public.fin_assert_owned('fin_counterparties', nullif(p_payload ->> 'counterparty_id', '')::uuid, v_org, 'Favorecido');
  perform public.fin_assert_owned('fin_cost_centers', nullif(p_payload ->> 'cost_center_id', '')::uuid, v_org, 'Centro de custo');
  perform public.fin_assert_owned('fin_properties', nullif(p_payload ->> 'property_id', '')::uuid, v_org, 'Imóvel');

  perform public.fin_generate_recurrence(v_id, v_horizon);
  return v_id;
end;
$$;

-- Gera previsões de todas as recorrências ativas até o horizonte (idempotente).
create or replace function public.app_fin_generate_recurrences(p_horizon_days integer default 90, p_metadata jsonb default '{}'::jsonb)
returns integer
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_id    uuid;
  v_count integer := 0;
begin
  perform public.set_audit_metadata(p_metadata);
  for v_id in select id from public.fin_recurrences where organization_id = v_org and is_active loop
    v_count := v_count + public.fin_generate_recurrence(
      v_id, (public.fin_today() + greatest(1, least(coalesce(p_horizon_days, 90), 730)))::date
    );
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------
grant execute on function
  public.fin_normalize(text),
  public.fin_account_movements(uuid),
  public.fin_line_candidates(uuid),
  public.fin_reconciliation_suggestions(uuid),
  public.fin_statement_lines_list(uuid, text),
  public.fin_reconciliation_summary(uuid),
  public.app_fin_save_rule(jsonb, uuid, jsonb),
  public.app_fin_import_statement(uuid, jsonb, jsonb),
  public.app_fin_match_line(uuid, uuid, uuid, jsonb),
  public.app_fin_confirm_suggestions(uuid, uuid[], jsonb),
  public.app_fin_settle_from_line(uuid, uuid, jsonb),
  public.app_fin_create_from_line(uuid, jsonb, jsonb),
  public.app_fin_create_from_rules(uuid[], jsonb),
  public.app_fin_unmatch_line(uuid, jsonb),
  public.app_fin_ignore_line(uuid, text, jsonb),
  public.app_fin_save_recurrence(jsonb, uuid, jsonb),
  public.app_fin_generate_recurrences(integer, jsonb),
  public.fin_suggest_category(text, text, uuid)
to authenticated;

-- ===================== 0012_finance_reports_close.sql =====================
-- =============================================================================
-- 0012 — Controle Financeiro, Fase 3: DRE gerencial, fluxo de caixa projetado,
-- fechamento mensal e central de inteligência.
--
-- * Fechamento: um mês fechado bloqueia QUALQUER efeito no livro-razão com data
--   nesse mês (lançar, editar valor/categoria/data, baixar, estornar, cancelar).
--   O bloqueio fica num único ponto: antes de inserir um lote em
--   fin_ledger_batches. Reabrir exige perfil administrador e justificativa.
-- * DRE e projeção são funções SQL — as telas e os relatórios só exibem.
-- * Inteligência: alertas determinísticos e explicáveis, calculados dos dados
--   reais. Nenhum alerta executa ação.
-- =============================================================================

-- Valor em reais no padrão brasileiro, independente do locale do servidor.
create or replace function public.fin_brl(p_value numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || translate(to_char(coalesce(p_value, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- -----------------------------------------------------------------------------
-- 1. Fechamento mensal
-- -----------------------------------------------------------------------------
create table if not exists public.fin_period_closes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year            integer not null check (year between 2000 and 2100),
  month           integer not null check (month between 1 and 12),
  closed_at       timestamptz not null default now(),
  closed_by       uuid references public.profiles (id),
  notes           text,
  snapshot        jsonb not null default '{}'::jsonb,
  reopened_at     timestamptz,
  reopened_by     uuid references public.profiles (id),
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fin_period_closes_reopen_ck check (
    (reopened_at is null and reopen_reason is null) or (reopened_at is not null and length(btrim(reopen_reason)) >= 10)
  )
);
create unique index if not exists fin_period_closes_active_uidx
  on public.fin_period_closes (organization_id, year, month) where reopened_at is null;

drop trigger if exists fin_period_closes_touch_updated_at on public.fin_period_closes;
create trigger fin_period_closes_touch_updated_at before update on public.fin_period_closes
  for each row execute function public.touch_updated_at();
drop trigger if exists fin_period_closes_audit on public.fin_period_closes;
create trigger fin_period_closes_audit after insert or update or delete on public.fin_period_closes
  for each row execute function public.audit_row_change();

alter table public.fin_period_closes enable row level security;
drop policy if exists fin_period_closes_select on public.fin_period_closes;
create policy fin_period_closes_select on public.fin_period_closes for select to authenticated
  using (public.fin_can(organization_id, 'view'));
drop policy if exists fin_period_closes_insert on public.fin_period_closes;
create policy fin_period_closes_insert on public.fin_period_closes for insert to authenticated
  with check (public.fin_can(organization_id, 'close') and public.fin_rpc_context());
drop policy if exists fin_period_closes_update on public.fin_period_closes;
create policy fin_period_closes_update on public.fin_period_closes for update to authenticated
  using (public.fin_can(organization_id, 'close'))
  with check (public.fin_can(organization_id, 'close') and public.fin_rpc_context());
grant select, insert, update on public.fin_period_closes to authenticated;
revoke all on public.fin_period_closes from anon;

create or replace function public.fin_is_period_closed(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fin_period_closes
    where organization_id = p_org
      and year = extract(year from p_date)::integer
      and month = extract(month from p_date)::integer
      and reopened_at is null
  );
$$;

-- Ponto único de bloqueio: todo efeito no razão passa por um lote.
create or replace function public.fin_block_closed_period()
returns trigger
language plpgsql
as $$
begin
  if public.fin_is_period_closed(new.organization_id, new.posting_date) then
    raise exception 'O mês de % está fechado no Controle Financeiro. Reabra o mês para alterar lançamentos com data nele.',
      to_char(new.posting_date, 'MM/YYYY')
      using errcode = 'CF001';
  end if;
  return new;
end;
$$;

drop trigger if exists fin_ledger_batches_closed_period on public.fin_ledger_batches;
create trigger fin_ledger_batches_closed_period
  before insert on public.fin_ledger_batches
  for each row execute function public.fin_block_closed_period();

-- Itens a revisar antes de fechar o mês. Avisos não impedem o fechamento.
create or replace function public.fin_close_checklist(p_year integer, p_month integer)
returns table (check_key text, label text, severity text, quantity integer, amount numeric, href text)
language sql
stable
as $$
  with org as (select public.app_current_org() as id),
  bounds as (
    select make_date(p_year, p_month, 1) as d_from,
           (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as d_to
  )
  select 'statement_pending', 'Linhas de extrato do mês ainda não conciliadas', 'warning',
         count(*)::integer, coalesce(sum(abs(l.amount)), 0), '/financeiro/conciliacao'
  from public.fin_statement_lines l, org, bounds
  where l.organization_id = org.id and l.status = 'pending' and l.posted_on between bounds.d_from and bounds.d_to
  union all
  select 'forecast_past', 'Previsões com data no mês que não foram confirmadas nem baixadas', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-pagar?status=forecast'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.status = 'forecast' and d.reference_date between bounds.d_from and bounds.d_to
  union all
  select 'payables_overdue', 'Contas a pagar vencidas no mês ainda em aberto', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-pagar?status=overdue'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.kind = 'expense' and d.status in ('open', 'partial')
    and d.reference_date between bounds.d_from and bounds.d_to and d.reference_date < public.fin_today()
  union all
  select 'receivables_overdue', 'Contas a receber vencidas no mês ainda em aberto', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-receber?status=overdue'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.kind = 'income' and d.status in ('open', 'partial')
    and d.reference_date between bounds.d_from and bounds.d_to and d.reference_date < public.fin_today()
  union all
  select 'commissions_out', 'Comissões do mês registradas que não entraram no caixa', 'info',
         count(*)::integer, coalesce(sum(t.gross_commission), 0), '/financeiro/imobiliario'
  from public.financial_entry_totals t, org, bounds
  where t.organization_id = org.id and t.deleted_at is null and t.gross_commission > 0
    and t.entry_date between bounds.d_from and bounds.d_to
    and not exists (select 1 from public.fin_operations o where o.commission_entry_id = t.entry_id and o.cancelled_at is null);
$$;

create or replace function public.app_fin_close_period(
  p_year     integer,
  p_month    integer,
  p_notes    text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('close');
  v_from    date := make_date(p_year, p_month, 1);
  v_to      date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_id      uuid;
  v_caixa   jsonb;
  v_comp    jsonb;
begin
  perform public.set_audit_metadata(p_metadata);
  if v_to >= public.fin_today() then
    raise exception 'Só é possível fechar um mês depois que ele termina.' using errcode = 'CF002';
  end if;
  if public.fin_is_period_closed(v_org, v_from) then
    raise exception 'Este mês já está fechado.' using errcode = 'CF003';
  end if;

  select to_jsonb(s) into v_caixa from public.fin_report_summary(v_from, v_to, 'caixa') s;
  select to_jsonb(s) into v_comp from public.fin_report_summary(v_from, v_to, 'competencia') s;

  insert into public.fin_period_closes (organization_id, year, month, closed_by, notes, snapshot)
  values (
    v_org, p_year, p_month, public.current_profile_id(), nullif(btrim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'caixa', v_caixa,
      'competencia', v_comp,
      'checklist', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.fin_close_checklist(p_year, p_month) c),
      'balances', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.fin_account_balances(v_to) b)
    )
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_fin_reopen_period(
  p_year     integer,
  p_month    integer,
  p_reason   text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('admin');
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo da reabertura com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;
  update public.fin_period_closes
     set reopened_at = now(), reopened_by = public.current_profile_id(), reopen_reason = btrim(p_reason)
   where organization_id = v_org and year = p_year and month = p_month and reopened_at is null;
  if not found then
    raise exception 'Este mês não está fechado.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. DRE gerencial — valores por categoria e mês, com sinal de efeito no caixa
--    (+ entrada, − saída). As linhas e subtotais são montados a partir disto.
-- -----------------------------------------------------------------------------
create or replace function public.fin_report_dre(p_from date, p_to date, p_regime text default 'competencia')
returns table (
  nature        text,
  group_id      uuid,
  group_name    text,
  group_order   integer,
  category_id   uuid,
  category_name text,
  period_key    text,
  amount        numeric
)
language sql
stable
as $$
  select i.nature,
         g.id, g.name, g.sort_order,
         c.id, c.name,
         to_char(i.item_date, 'YYYY-MM'),
         sum(case when i.kind = 'income' then i.amount else -i.amount end)
  from public.fin_pl_items(p_from, p_to, coalesce(p_regime, 'competencia')) i
  join public.fin_categories c on c.id = i.category_id
  left join public.fin_categories g on g.id = coalesce(c.parent_id, c.id)
  group by i.nature, g.id, g.name, g.sort_order, c.id, c.name, to_char(i.item_date, 'YYYY-MM')
  order by g.sort_order, g.name, c.name, 7;
$$;

-- -----------------------------------------------------------------------------
-- 3. Fluxo de caixa projetado
--    Saldo de hoje + títulos em aberto (inclui previsões) pela data de
--    vencimento. A primeira linha (bucket_start nulo) reúne os VENCIDOS.
-- -----------------------------------------------------------------------------
create or replace function public.fin_cash_projection(
  p_days              integer default 90,
  p_bucket            text default 'week',
  p_include_forecasts boolean default true
)
returns table (
  bucket_start    date,
  bucket_end      date,
  inflow          numeric,
  outflow         numeric,
  third_party_out numeric,
  forecast_in     numeric,
  forecast_out    numeric,
  opening_balance numeric,
  closing_balance numeric
)
language sql
stable
as $$
  with params as (
    select public.fin_today() as today,
           (public.fin_today() + greatest(1, least(coalesce(p_days, 90), 730)))::date as horizon,
           case when p_bucket in ('day', 'week', 'month') then p_bucket else 'week' end as bucket
  ),
  opening as (
    select coalesce(sum(p.amount), 0) as balance
    from public.fin_postings p, params
    where p.organization_id = public.app_current_org() and p.bucket = 'cash' and p.posting_date <= params.today
  ),
  items as (
    select d.kind, d.nature, d.status, d.remaining_amount as amount,
           d.reference_date < params.today as overdue,
           case params.bucket
             when 'day'   then d.reference_date
             when 'month' then date_trunc('month', d.reference_date)::date
             else (params.today + ((d.reference_date - params.today) / 7) * 7)
           end as b_start
    from public.fin_entries_detail d, params
    where d.organization_id = public.app_current_org()
      and d.kind in ('income', 'expense')
      and d.status in ('open', 'partial', 'forecast')
      and (p_include_forecasts or d.status <> 'forecast')
      and d.reference_date <= params.horizon
      and d.remaining_amount > 0
  ),
  series as (
    select gs::date as b_start
    from params,
         generate_series(
           case params.bucket when 'month' then date_trunc('month', params.today)::date else params.today end,
           params.horizon,
           case params.bucket when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '7 days' end
         ) gs
  ),
  buckets as (
    select null::date as b_start, null::date as b_end, 0 as ord
    union all
    select s.b_start,
           least(
             case (select bucket from params)
               when 'day' then s.b_start
               when 'month' then (s.b_start + interval '1 month - 1 day')::date
               else s.b_start + 6
             end,
             (select horizon from params)
           ),
           1
    from series s
  ),
  totals as (
    select b.b_start, b.b_end, b.ord,
      coalesce(sum(i.amount) filter (where i.kind = 'income'), 0) as inflow,
      coalesce(sum(i.amount) filter (where i.kind = 'expense'), 0) as outflow,
      coalesce(sum(i.amount) filter (where i.kind = 'expense' and i.nature = 'third_party'), 0) as third_party_out,
      coalesce(sum(i.amount) filter (where i.kind = 'income' and i.status = 'forecast'), 0) as forecast_in,
      coalesce(sum(i.amount) filter (where i.kind = 'expense' and i.status = 'forecast'), 0) as forecast_out
    from buckets b
    left join items i
      on (b.ord = 0 and i.overdue)
      or (b.ord = 1 and not i.overdue and i.b_start = b.b_start)
    group by b.b_start, b.b_end, b.ord
  )
  select t.b_start, t.b_end, t.inflow, t.outflow, t.third_party_out, t.forecast_in, t.forecast_out,
         opening.balance + coalesce(sum(t.inflow - t.outflow) over (order by t.ord, t.b_start
           rows between unbounded preceding and 1 preceding), 0),
         opening.balance + sum(t.inflow - t.outflow) over (order by t.ord, t.b_start rows between unbounded preceding and current row)
  from totals t, opening
  order by t.ord, t.b_start;
$$;

-- -----------------------------------------------------------------------------
-- 4. Central de inteligência — alertas explicáveis a partir dos dados reais
-- -----------------------------------------------------------------------------
create or replace function public.fin_insights()
returns table (
  insight_key text,
  severity    text,      -- critical | warning | info | positive
  title       text,
  detail      text,
  metric      numeric,
  href        text
)
language plpgsql
stable
as $$
declare
  v_org          uuid := public.app_current_org();
  v_today        date := public.fin_today();
  v_month_start  date := date_trunc('month', public.fin_today())::date;
  v_last_from    date := (date_trunc('month', public.fin_today()) - interval '1 month')::date;
  v_last_to      date := (date_trunc('month', public.fin_today()) - interval '1 day')::date;
  v_prev_from    date := (date_trunc('month', public.fin_today()) - interval '2 months')::date;
  v_prev_to      date := (date_trunc('month', public.fin_today()) - interval '1 month' - interval '1 day')::date;
  v_sum          record;
  v_last         record;
  v_prev         record;
  v_neg          record;
  v_count        integer;
  v_amount       numeric;
  v_row          record;
begin
  if v_org is null or not public.fin_can(v_org, 'view') then
    return;
  end if;

  select * into v_sum from public.fin_report_summary(v_month_start, v_today, 'caixa');

  -- Dinheiro de terceiros financiando a operação
  if v_sum.own_available < 0 then
    insight_key := 'own_available_negative'; severity := 'critical';
    title := 'O caixa está usando dinheiro de proprietários e corretores';
    detail := 'O saldo em contas é menor que o total devido a terceiros e cauções. Faltam '
      || public.fin_brl(-v_sum.own_available) || ' para cobrir os repasses.';
    metric := v_sum.own_available; href := '/financeiro';
    return next;
  end if;

  -- Caixa projetado negativo nos próximos 90 dias
  select * into v_neg from public.fin_cash_projection(90, 'week') p
  where p.closing_balance < 0 order by p.bucket_start nulls first limit 1;
  if found then
    insight_key := 'projection_negative'; severity := 'critical';
    title := case when v_neg.bucket_start is null
      then 'Os títulos vencidos já deixam o caixa negativo'
      else 'O caixa projetado fica negativo na semana de ' || to_char(v_neg.bucket_start, 'DD/MM') end;
    detail := 'Saldo projetado: ' || public.fin_brl(v_neg.closing_balance)
      || '. Considera contas a pagar e a receber em aberto e as previsões.';
    metric := v_neg.closing_balance; href := '/financeiro/fluxo';
    return next;
  end if;

  -- Repasses atrasados a proprietários/corretores
  select count(*)::integer, coalesce(sum(d.remaining_amount), 0) into v_count, v_amount
  from public.fin_entries_detail d
  where d.organization_id = v_org and d.kind = 'expense' and d.nature = 'third_party'
    and d.status in ('open', 'partial') and d.is_overdue;
  if v_count > 0 then
    insight_key := 'third_party_overdue'; severity := 'critical';
    title := v_count || ' repasse(s) a terceiros em atraso';
    detail := 'Total de ' || public.fin_brl(v_amount) || ' que pertence a proprietários ou corretores e já venceu.';
    metric := v_amount; href := '/financeiro/a-pagar?status=overdue&natureza=third_party';
    return next;
  end if;

  if v_sum.payables_overdue > 0 then
    insight_key := 'payables_overdue'; severity := 'warning';
    title := 'Contas a pagar vencidas';
    detail := public.fin_brl(v_sum.payables_overdue) || ' em despesas da imobiliária passaram do vencimento.';
    metric := v_sum.payables_overdue; href := '/financeiro/a-pagar?status=overdue';
    return next;
  end if;

  if v_sum.receivables_overdue > 0 then
    insight_key := 'receivables_overdue'; severity := 'warning';
    title := 'Recebimentos em atraso';
    detail := public.fin_brl(v_sum.receivables_overdue) || ' a receber com vencimento passado.';
    metric := v_sum.receivables_overdue; href := '/financeiro/a-receber?status=overdue';
    return next;
  end if;

  -- Previsões vencidas sem confirmação
  select count(*)::integer, coalesce(sum(d.remaining_amount), 0) into v_count, v_amount
  from public.fin_entries_detail d
  where d.organization_id = v_org and d.status = 'forecast' and d.reference_date < v_today;
  if v_count > 0 then
    insight_key := 'forecast_past'; severity := 'warning';
    title := v_count || ' previsão(ões) com data passada';
    detail := 'Confirme, baixe ou cancele para que o fluxo projetado reflita a realidade ('
      || public.fin_brl(v_amount) || ').';
    metric := v_amount; href := '/financeiro/a-pagar?status=forecast';
    return next;
  end if;

  -- Extrato pendente há mais de 7 dias
  select count(*)::integer, coalesce(sum(abs(l.amount)), 0) into v_count, v_amount
  from public.fin_statement_lines l
  where l.organization_id = v_org and l.status = 'pending' and l.posted_on < v_today - 7;
  if v_count > 0 then
    insight_key := 'statement_stale'; severity := 'warning';
    title := v_count || ' transação(ões) do banco sem conciliação há mais de 7 dias';
    detail := 'Movimentos que estão no extrato e ainda não foram identificados no sistema.';
    metric := v_amount; href := '/financeiro/conciliacao';
    return next;
  end if;

  -- Comissões fora do caixa (desde sempre)
  select count(*)::integer, coalesce(sum(t.gross_commission), 0) into v_count, v_amount
  from public.financial_entry_totals t
  where t.organization_id = v_org and t.deleted_at is null and t.gross_commission > 0
    and not exists (select 1 from public.fin_operations o where o.commission_entry_id = t.entry_id and o.cancelled_at is null);
  if v_count > 0 then
    insight_key := 'commissions_out'; severity := 'info';
    title := v_count || ' comissão(ões) registrada(s) sem entrada no caixa';
    detail := 'Somam ' || public.fin_brl(v_amount) || ' em comissão bruta. Lance quando o dinheiro entrar.';
    metric := v_amount; href := '/financeiro/imobiliario';
    return next;
  end if;

  -- Mês anterior sem fechamento (com movimento)
  if exists (select 1 from public.fin_ledger_batches b where b.organization_id = v_org and b.posting_date between v_last_from and v_last_to)
     and not public.fin_is_period_closed(v_org, v_last_from) then
    insight_key := 'last_month_open'; severity := 'info';
    title := 'O mês de ' || to_char(v_last_from, 'MM/YYYY') || ' ainda não foi fechado';
    detail := 'Fechar o mês trava os números já conferidos e guarda um retrato do resultado.';
    metric := null; href := '/financeiro/fechamento';
    return next;
  end if;

  -- Resultado do último mês fechado x anterior (competência)
  select * into v_last from public.fin_report_summary(v_last_from, v_last_to, 'competencia');
  select * into v_prev from public.fin_report_summary(v_prev_from, v_prev_to, 'competencia');
  if v_last.own_revenue > 0 or v_prev.own_revenue > 0 then
    if v_prev.net_result <> 0 then
      insight_key := 'result_trend';
      severity := case when v_last.net_result >= v_prev.net_result then 'positive' else 'warning' end;
      title := 'Resultado de ' || to_char(v_last_from, 'MM/YYYY') || ': '
        || public.fin_brl(v_last.net_result)
        || case when v_last.net_result >= v_prev.net_result then ' (acima' else ' (abaixo' end
        || ' do mês anterior)';
      detail := 'Mês anterior: ' || public.fin_brl(v_prev.net_result)
        || '. Variação de ' || replace(to_char(round((v_last.net_result - v_prev.net_result) / abs(v_prev.net_result) * 100, 1), 'FM9999990.0'), '.', ',') || '%.';
      metric := v_last.net_result - v_prev.net_result; href := '/financeiro/dre';
      return next;
    end if;
  end if;

  -- Despesas que cresceram mais de 30% sobre a média dos 3 meses anteriores
  for v_row in
    with last_month as (
      select i.category_id, sum(i.amount) as total
      from public.fin_pl_items(v_last_from, v_last_to, 'competencia') i
      where i.kind = 'expense' and i.nature in ('direct_cost', 'operating_expense', 'other_expense')
      group by i.category_id
    ),
    history as (
      select i.category_id, sum(i.amount) / 3.0 as average
      from public.fin_pl_items((v_last_from - interval '3 months')::date, (v_last_from - 1), 'competencia') i
      where i.kind = 'expense'
      group by i.category_id
    )
    select c.name, l.total, h.average
    from last_month l
    join history h on h.category_id = l.category_id
    join public.fin_categories c on c.id = l.category_id
    where h.average > 0 and l.total > h.average * 1.3 and l.total - h.average >= 200
    order by l.total - h.average desc
    limit 3
  loop
    insight_key := 'expense_spike'; severity := 'warning';
    title := v_row.name || ' subiu ' || to_char(round((v_row.total / v_row.average - 1) * 100), 'FM99990') || '% em ' || to_char(v_last_from, 'MM/YYYY');
    detail := 'Gasto de ' || public.fin_brl(v_row.total) || ' contra média de '
      || public.fin_brl(v_row.average) || ' nos 3 meses anteriores.';
    metric := v_row.total - v_row.average; href := '/financeiro/dre';
    return next;
  end loop;

  return;
end;
$$;

grant execute on function
  public.fin_brl(numeric),
  public.fin_is_period_closed(uuid, date),
  public.fin_close_checklist(integer, integer),
  public.app_fin_close_period(integer, integer, text, jsonb),
  public.app_fin_reopen_period(integer, integer, text, jsonb),
  public.fin_report_dre(date, date, text),
  public.fin_cash_projection(integer, text, boolean),
  public.fin_insights()
to authenticated;

-- ===================== 0013_finance_simple.sql =====================
-- =============================================================================
-- 0013 — Controle Financeiro simplificado
--
-- * Recorrências de valor FIXO (salário) ou VARIÁVEL (energia): a variável usa o
--   último valor pago como estimativa das próximas.
-- * Lançamento rápido (app_fin_quick_entry): avulso ou recorrente, já pago ou não,
--   numa única chamada.
-- * Pagar uma ocorrência com o valor real (app_fin_pay_occurrence).
-- * Cartões do ano (fin_report_year_cards): números de cada mês para a tela inicial.
-- * Comissão recebida: status por lançamento de comissão e bloqueio de alteração
--   de valores depois de recebida.
-- * Importação administrativa (documentos escaneados): só service_role, executa
--   as mesmas RPCs em nome do usuário, por lote, com desfazer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Recorrência fixa x variável
-- -----------------------------------------------------------------------------
alter table public.fin_recurrences add column if not exists value_mode text not null default 'fixed';
alter table public.fin_recurrences drop constraint if exists fin_recurrences_value_mode_ck;
alter table public.fin_recurrences add constraint fin_recurrences_value_mode_ck check (value_mode in ('fixed', 'variable'));

-- Funcionários como favorecidos (salários, vale-transporte...).
alter table public.fin_counterparties drop constraint if exists fin_counterparties_kind_check;
alter table public.fin_counterparties add constraint fin_counterparties_kind_check check (kind in (
  'supplier', 'client', 'owner', 'tenant', 'broker', 'partner', 'government', 'bank', 'other', 'employee'
));

alter table public.fin_entries add column if not exists import_batch_id uuid;
create index if not exists fin_entries_import_batch_idx on public.fin_entries (import_batch_id) where import_batch_id is not null;

-- Valor usado nas próximas previsões: fixo = valor cadastrado; variável = último pago.
create or replace function public.fin_recurrence_estimate(p_recurrence_id uuid)
returns numeric
language sql
stable
as $$
  select case
    when r.value_mode = 'variable' then coalesce((
      select e.amount from public.fin_entries e
      where e.recurrence_id = r.id and e.cancelled_at is null and e.status in ('settled', 'partial')
      order by e.competence_date desc, e.updated_at desc
      limit 1
    ), r.amount)
    else r.amount
  end
  from public.fin_recurrences r
  where r.id = p_recurrence_id;
$$;

-- Mesma lógica da 0011, agora usando a estimativa (fixa ou variável).
create or replace function public.fin_generate_recurrence(p_recurrence_id uuid, p_until date)
returns integer
language plpgsql
as $$
declare
  v_rec    public.fin_recurrences%rowtype;
  v_date   date;
  v_n      integer := 0;
  v_count  integer := 0;
  v_entry  public.fin_entries%rowtype;
  v_limit  date;
  v_amount numeric;
begin
  select * into v_rec from public.fin_recurrences where id = p_recurrence_id for update;
  if not found or not v_rec.is_active then
    return 0;
  end if;
  v_limit := least(p_until, coalesce(v_rec.end_date, p_until));
  v_amount := public.fin_recurrence_estimate(v_rec.id);

  loop
    v_date := (v_rec.start_date + public.fin_recurrence_step(v_rec.frequency) * v_n)::date;
    exit when v_date > v_limit or v_n > 600;
    if (v_rec.forecast_until is null or v_date > v_rec.forecast_until)
       and not exists (
         select 1 from public.fin_entries
         where recurrence_id = v_rec.id and competence_date = v_date and cancelled_at is null
       ) then
      insert into public.fin_entries (
        organization_id, kind, description, amount, category_id, account_id, counterparty_id,
        cost_center_id, property_id, payment_method, competence_date, due_date, is_forecast,
        notes, origin, recurrence_id, created_by, updated_by
      )
      values (
        v_rec.organization_id, v_rec.kind, v_rec.description, v_amount, v_rec.category_id,
        v_rec.account_id, v_rec.counterparty_id, v_rec.cost_center_id, v_rec.property_id,
        v_rec.payment_method, v_date, v_date, true, v_rec.notes, 'recurrence', v_rec.id,
        public.current_profile_id(), public.current_profile_id()
      )
      returning * into v_entry;
      perform public.fin_validate_entry(v_entry);
      perform public.fin_refresh_entry(v_entry.id);
      v_count := v_count + 1;
    end if;
    v_n := v_n + 1;
  end loop;

  update public.fin_recurrences
     set forecast_until = greatest(coalesce(forecast_until, v_limit), v_limit)
   where id = v_rec.id;
  return v_count;
end;
$$;

create or replace function public.app_fin_set_recurrence_value_mode(
  p_recurrence_id uuid,
  p_value_mode   text,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(p_metadata);
  if p_value_mode not in ('fixed', 'variable') then
    raise exception 'Informe se o valor é fixo ou variável.' using errcode = 'CF002';
  end if;
  update public.fin_recurrences set value_mode = p_value_mode
   where id = p_recurrence_id and organization_id = v_org;
  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Pagar uma ocorrência com o valor real
-- -----------------------------------------------------------------------------
create or replace function public.fin_pay_occurrence_internal(
  p_entry_id   uuid,
  p_amount     numeric,
  p_paid_on    date,
  p_account_id uuid
)
returns uuid
language plpgsql
as $$
declare
  v_entry      public.fin_entries%rowtype;
  v_amount     numeric := round(p_amount, 2);
  v_settlement uuid;
  v_kind       text;
begin
  select * into v_entry from public.fin_entries where id = p_entry_id for update;
  if v_entry.kind not in ('income', 'expense') or v_entry.cancelled_at is not null then
    raise exception 'Este lançamento não pode ser pago.' using errcode = 'CF002';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe o valor pago.' using errcode = 'CF002';
  end if;

  -- Valor diferente do previsto (recorrência variável): ajusta antes de baixar.
  if v_amount <> v_entry.amount - v_entry.settled_amount then
    if v_entry.settled_amount > 0 then
      raise exception 'Este lançamento já tem baixa parcial; registre o restante pela tela de baixa.' using errcode = 'CF002';
    end if;
    update public.fin_entries set amount = v_amount, updated_by = public.current_profile_id() where id = v_entry.id;
    if not v_entry.is_forecast then
      perform public.fin_reverse_entry_batches(v_entry.id, array['recognition']);
      perform public.fin_post_entry(v_entry.id);
    end if;
  end if;

  v_settlement := public.fin_insert_settlement(
    v_entry.id, coalesce(p_account_id, v_entry.account_id), coalesce(p_paid_on, public.fin_today()), v_amount, null, null
  );

  -- Variável: as próximas previsões ainda intocadas passam a usar este valor.
  if v_entry.recurrence_id is not null then
    select value_mode into v_kind from public.fin_recurrences where id = v_entry.recurrence_id;
    if v_kind = 'variable' then
      update public.fin_entries
         set amount = v_amount
       where recurrence_id = v_entry.recurrence_id
         and status = 'forecast' and settled_amount = 0
         and competence_date > v_entry.competence_date;
    end if;
  end if;
  return v_settlement;
end;
$$;

create or replace function public.app_fin_pay_occurrence(
  p_entry_id uuid,
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
begin
  perform public.set_audit_metadata(p_metadata);
  if not exists (select 1 from public.fin_entries where id = p_entry_id and organization_id = v_org) then
    raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
  end if;
  return public.fin_pay_occurrence_internal(
    p_entry_id,
    nullif(p_payload ->> 'amount', '')::numeric,
    nullif(p_payload ->> 'paid_on', '')::date,
    nullif(p_payload ->> 'account_id', '')::uuid
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Lançamento rápido (avulso ou recorrente; pago ou a pagar)
-- -----------------------------------------------------------------------------
create or replace function public.app_fin_quick_entry(
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org        uuid := public.fin_require('write');
  v_kind       text := p_payload ->> 'kind';
  v_recurring  text := coalesce(nullif(p_payload ->> 'recurring', ''), 'none');
  v_date       date := coalesce(nullif(p_payload ->> 'date', '')::date, public.fin_today());
  v_paid       boolean := coalesce((p_payload ->> 'paid')::boolean, false);
  v_paid_on    date := coalesce(nullif(p_payload ->> 'paid_on', '')::date, v_date);
  v_account    uuid := nullif(p_payload ->> 'account_id', '')::uuid;
  v_amount     numeric := round(nullif(p_payload ->> 'amount', '')::numeric, 2);
  v_ids        uuid[];
  v_rec        uuid;
  v_entry      uuid;
  v_batch      uuid := nullif(p_payload ->> 'import_batch_id', '')::uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  if v_kind not in ('income', 'expense') then
    raise exception 'Escolha se é uma entrada ou uma saída.' using errcode = 'CF002';
  end if;
  if v_recurring not in ('none', 'fixed', 'variable') then
    raise exception 'Repetição inválida.' using errcode = 'CF002';
  end if;
  if v_paid and v_account is null then
    raise exception 'Informe a conta em que o valor foi pago ou recebido.' using errcode = 'CF002';
  end if;

  if v_recurring = 'none' then
    v_ids := public.app_fin_save_entry(
      jsonb_build_object(
        'kind', v_kind,
        'description', p_payload ->> 'description',
        'amount', v_amount,
        'category_id', p_payload ->> 'category_id',
        'account_id', v_account,
        'counterparty_id', p_payload ->> 'counterparty_id',
        'cost_center_id', p_payload ->> 'cost_center_id',
        'property_id', p_payload ->> 'property_id',
        'payment_method', p_payload ->> 'payment_method',
        'document_number', p_payload ->> 'document_number',
        'competence_date', v_date,
        'due_date', coalesce(nullif(p_payload ->> 'due_date', ''), v_date::text),
        'notes', p_payload ->> 'notes',
        'settle_now', v_paid,
        'settlement_account_id', v_account,
        'settled_on', v_paid_on
      ),
      null, p_metadata
    );
    v_entry := v_ids[1];
  else
    v_rec := public.app_fin_save_recurrence(
      jsonb_build_object(
        'kind', v_kind,
        'description', p_payload ->> 'description',
        'amount', v_amount,
        'category_id', p_payload ->> 'category_id',
        'account_id', v_account,
        'counterparty_id', p_payload ->> 'counterparty_id',
        'cost_center_id', p_payload ->> 'cost_center_id',
        'property_id', p_payload ->> 'property_id',
        'payment_method', p_payload ->> 'payment_method',
        'frequency', 'monthly',
        'start_date', v_date,
        'notes', p_payload ->> 'notes'
      ),
      null, p_metadata
    );
    update public.fin_recurrences set value_mode = v_recurring where id = v_rec;

    select id into v_entry from public.fin_entries
    where recurrence_id = v_rec and competence_date = v_date and cancelled_at is null;
    if v_entry is null then
      raise exception 'Não foi possível gerar a ocorrência deste mês.' using errcode = 'CF002';
    end if;

    if v_paid then
      perform public.fin_pay_occurrence_internal(v_entry, v_amount, v_paid_on, v_account);
    else
      -- A ocorrência do mês informado é uma conta real a pagar/receber, não previsão.
      update public.fin_entries set is_forecast = false where id = v_entry;
      perform public.fin_post_entry(v_entry);
      perform public.fin_refresh_entry(v_entry);
    end if;
    update public.fin_entries
       set document_number = nullif(btrim(coalesce(p_payload ->> 'document_number', '')), '')
     where id = v_entry and nullif(btrim(coalesce(p_payload ->> 'document_number', '')), '') is not null;
  end if;

  if v_batch is not null then
    update public.fin_entries set import_batch_id = v_batch, origin = 'import' where id = v_entry;
  end if;
  return v_entry;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Cartões do ano (tela inicial)
-- -----------------------------------------------------------------------------
create or replace function public.fin_report_year_cards(p_year integer)
returns table (
  month                integer,
  cash_in              numeric,
  cash_out             numeric,
  revenue              numeric,
  expenses             numeric,
  result               numeric,
  closing_balance      numeric,
  payables_count       integer,
  payables_amount      numeric,
  receivables_count    integer,
  receivables_amount   numeric,
  statement_pending    integer,
  is_closed            boolean
)
language sql
stable
as $$
  with comp as (
    select * from public.fin_report_monthly(make_date(p_year, 1, 1), make_date(p_year, 12, 31), 'competencia')
  ),
  cash as (
    select * from public.fin_report_monthly(make_date(p_year, 1, 1), make_date(p_year, 12, 31), 'caixa')
  ),
  open_items as (
    select extract(month from d.reference_date)::integer as month,
      count(*) filter (where d.kind = 'expense')::integer as payables_count,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'expense'), 0) as payables_amount,
      count(*) filter (where d.kind = 'income')::integer as receivables_count,
      coalesce(sum(d.remaining_amount) filter (where d.kind = 'income'), 0) as receivables_amount
    from public.fin_entries_detail d
    where d.organization_id = public.app_current_org()
      and d.kind in ('income', 'expense')
      and d.status in ('open', 'partial', 'forecast')
      and extract(year from d.reference_date) = p_year
    group by 1
  ),
  lines as (
    select extract(month from l.posted_on)::integer as month, count(*)::integer as pending
    from public.fin_statement_lines l
    where l.organization_id = public.app_current_org() and l.status = 'pending'
      and extract(year from l.posted_on) = p_year
    group by 1
  )
  select m.month,
         coalesce(cash.cash_in, 0), coalesce(cash.cash_out, 0),
         coalesce(comp.revenue, 0), coalesce(comp.expenses, 0), coalesce(comp.result, 0),
         coalesce(cash.closing_balance, 0),
         coalesce(o.payables_count, 0), coalesce(o.payables_amount, 0),
         coalesce(o.receivables_count, 0), coalesce(o.receivables_amount, 0),
         coalesce(lines.pending, 0),
         public.fin_is_period_closed(public.app_current_org(), make_date(p_year, m.month, 1))
  from generate_series(1, 12) as m(month)
  left join comp on comp.month = m.month
  left join cash on cash.month = m.month
  left join open_items o on o.month = m.month
  left join lines on lines.month = m.month
  order by m.month;
$$;

-- -----------------------------------------------------------------------------
-- 5. Comissões recebidas no caixa
-- -----------------------------------------------------------------------------
create or replace function public.fin_commission_receipts(p_entry_ids uuid[])
returns table (entry_id uuid, operation_id uuid, received_on date, gross_amount numeric)
language sql
stable
as $$
  select o.commission_entry_id, o.id, o.reference_date, o.gross_amount
  from public.fin_operations o
  where o.organization_id = public.app_current_org()
    and o.commission_entry_id = any (p_entry_ids)
    and o.cancelled_at is null;
$$;

-- Depois de recebida, a comissão não pode mudar de valor sem antes desmarcar o
-- recebimento (o caixa ficaria diferente da comissão). Checado no fim da
-- transação, comparando os totais — salvar sem mudar valores continua livre.
create or replace function public.fin_assert_received_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid := coalesce(new.entry_id, old.entry_id);
  v_op       record;
  v_totals   record;
begin
  select * into v_op from public.fin_operations
  where commission_entry_id = v_entry_id and cancelled_at is null
  limit 1;
  if not found then
    return null;
  end if;

  select gross_commission, net_company_revenue, deleted_at into v_totals
  from public.financial_entry_totals where entry_id = v_entry_id;

  if v_totals is null or v_totals.deleted_at is not null
     or v_totals.gross_commission <> v_op.gross_amount
     or v_totals.net_company_revenue <> v_op.own_amount then
    raise exception 'Esta comissão já foi recebida no caixa. Desmarque o recebimento antes de alterar valores ou excluir.'
      using errcode = 'CF002';
  end if;
  return null;
end;
$$;

-- financial_entries usa "id"; o gatilho lê entry_id por uma visão de compatibilidade.
create or replace function public.fin_assert_received_commission_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op     record;
  v_totals record;
begin
  select * into v_op from public.fin_operations
  where commission_entry_id = new.id and cancelled_at is null
  limit 1;
  if not found then
    return null;
  end if;

  select gross_commission, net_company_revenue, deleted_at into v_totals
  from public.financial_entry_totals where entry_id = new.id;

  if v_totals is null or v_totals.deleted_at is not null
     or v_totals.gross_commission <> v_op.gross_amount
     or v_totals.net_company_revenue <> v_op.own_amount then
    raise exception 'Esta comissão já foi recebida no caixa. Desmarque o recebimento antes de alterar valores ou excluir.'
      using errcode = 'CF002';
  end if;
  return null;
end;
$$;

drop trigger if exists financial_entries_received_commission on public.financial_entries;
create constraint trigger financial_entries_received_commission
  after update on public.financial_entries
  deferrable initially deferred
  for each row execute function public.fin_assert_received_commission_entry();

drop trigger if exists entry_broker_splits_received_commission on public.entry_broker_splits;
create constraint trigger entry_broker_splits_received_commission
  after insert or update or delete on public.entry_broker_splits
  deferrable initially deferred
  for each row execute function public.fin_assert_received_commission();

-- -----------------------------------------------------------------------------
-- 6. Subcategorias úteis para os gastos do dia a dia (só se faltarem)
-- -----------------------------------------------------------------------------
create or replace function public.fin_seed_extra_categories(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grp  uuid;
  v_item record;
begin
  select id into v_grp from public.fin_categories
  where organization_id = p_organization_id and system_key = 'grp_operating_expense';
  if v_grp is null then
    return;
  end if;
  for v_item in
    select * from (values
      ('Energia elétrica', 'variable', 20),
      ('Água e esgoto', 'variable', 21),
      ('Internet e telefone', 'fixed', 22),
      ('Limpeza e conservação', 'variable', 23),
      ('Benefícios (vale-transporte, alimentação)', 'fixed', 24),
      ('Copa e cozinha', 'variable', 25)
    ) as c(name, cost, ord)
  loop
    if not exists (
      select 1 from public.fin_categories
      where organization_id = p_organization_id and parent_id = v_grp
        and public.fin_normalize(name) = public.fin_normalize(v_item.name)
    ) then
      insert into public.fin_categories (organization_id, parent_id, name, nature, cost_behavior, sort_order)
      values (p_organization_id, v_grp, v_item.name, 'operating_expense', v_item.cost, v_item.ord);
    end if;
  end loop;
end;
$$;

-- Organizações novas recebem o plano completo (padrão + extras).
create or replace function public.fin_seed_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fin_seed_categories(new.id);
  perform public.fin_seed_extra_categories(new.id);
  return new;
end;
$$;

do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform public.fin_seed_extra_categories(v_org);
  end loop;
end
$$;

revoke all on function public.fin_seed_extra_categories(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Importação administrativa (documentos escaneados) — só service_role
-- -----------------------------------------------------------------------------
-- Resolve nomes (categoria, conta, favorecido) e aponta problemas, sem gravar.
create or replace function public.fin_admin_resolve_import(p_org uuid, p_rows jsonb)
returns table (
  line          integer,
  kind          text,
  category_id   uuid,
  category_name text,
  account_id    uuid,
  account_name  text,
  problems      text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_index   integer := 0;
  v_kind    text;
  v_cat     record;
  v_acc     record;
  v_issues  text[];
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_issues := array[]::text[];
    v_kind := case lower(coalesce(v_row ->> 'kind', ''))
      when 'saida' then 'expense' when 'saída' then 'expense' when 'expense' then 'expense'
      when 'entrada' then 'income' when 'income' then 'income' else null end;
    if v_kind is null then
      v_issues := v_issues || 'tipo deve ser "entrada" ou "saida"';
    end if;

    select c.id, c.name into v_cat from public.fin_categories c
    where c.organization_id = p_org and c.parent_id is not null and c.is_active
      and public.fin_normalize(c.name) = public.fin_normalize(v_row ->> 'category')
    order by c.sort_order
    limit 1;
    if v_cat.id is null then
      v_issues := v_issues || ('categoria não encontrada: ' || coalesce(v_row ->> 'category', '(vazia)'));
    end if;

    if nullif(btrim(coalesce(v_row ->> 'account', '')), '') is not null then
      select a.id, a.name into v_acc from public.fin_accounts a
      where a.organization_id = p_org and a.is_active
        and public.fin_normalize(a.name) = public.fin_normalize(v_row ->> 'account')
      limit 1;
    else
      select a.id, a.name into v_acc from public.fin_accounts a
      where a.organization_id = p_org and a.is_active
      order by case a.kind when 'checking' then 0 else 1 end, a.created_at
      limit 1;
    end if;
    if v_acc.id is null and coalesce((v_row ->> 'paid')::boolean, false) then
      v_issues := v_issues || 'nenhuma conta encontrada para registrar o pagamento';
    end if;
    if nullif(v_row ->> 'amount', '') is null or (v_row ->> 'amount')::numeric <= 0 then
      v_issues := v_issues || 'valor inválido';
    end if;
    if nullif(v_row ->> 'date', '') is null then
      v_issues := v_issues || 'data ausente';
    end if;

    line := v_index; kind := v_kind;
    category_id := v_cat.id; category_name := v_cat.name;
    account_id := v_acc.id; account_name := v_acc.name;
    problems := v_issues;
    return next;
    v_cat := null; v_acc := null;
  end loop;
end;
$$;

create or replace function public.fin_admin_impersonate(p_user_email text)
returns table (user_id uuid, organization_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_org  uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_user_email));
  if v_user is null then
    raise exception 'Usuário % não encontrado.', p_user_email using errcode = 'CF005';
  end if;
  -- auth.uid() do Supabase lê request.jwt.claims; o ambiente de teste lê app.user_id.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('app.user_id', v_user::text, true);
  v_org := public.app_current_org();
  if v_org is null then
    raise exception 'Usuário sem organização ativa.' using errcode = 'CF005';
  end if;
  user_id := v_user; organization_id := v_org;
  return next;
end;
$$;

create or replace function public.fin_admin_preview_import(p_user_email text, p_rows jsonb)
returns table (line integer, kind text, category_name text, account_name text, problems text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select i.organization_id into v_org from public.fin_admin_impersonate(p_user_email) i;
  return query
    select r.line, r.kind, r.category_name, r.account_name, r.problems
    from public.fin_admin_resolve_import(v_org, p_rows) r;
end;
$$;

-- Grava o lote inteiro (ou nada). Retorna o id do lote para desfazer.
create or replace function public.fin_admin_import_entries(p_user_email text, p_rows jsonb, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid;
  v_batch     uuid := gen_random_uuid();
  v_resolved  record;
  v_row       jsonb;
  v_payee     uuid;
  v_ids       uuid[] := array[]::uuid[];
  v_problems  text[] := array[]::text[];
  v_paid      boolean;
  v_recurring text;
begin
  select i.organization_id into v_org from public.fin_admin_impersonate(p_user_email) i;

  for v_resolved in select * from public.fin_admin_resolve_import(v_org, p_rows) loop
    if array_length(v_resolved.problems, 1) > 0 then
      v_problems := v_problems || ('linha ' || v_resolved.line || ': ' || array_to_string(v_resolved.problems, '; '));
    end if;
  end loop;
  if array_length(v_problems, 1) > 0 then
    raise exception 'Lote recusado, nada foi gravado. %', array_to_string(v_problems, ' | ') using errcode = 'CF002';
  end if;

  for v_resolved in select * from public.fin_admin_resolve_import(v_org, p_rows) loop
    v_row := p_rows -> (v_resolved.line - 1);
    v_paid := coalesce((v_row ->> 'paid')::boolean, false);
    v_recurring := case lower(coalesce(v_row ->> 'recurring', 'nao'))
      when 'fixo' then 'fixed' when 'fixed' then 'fixed'
      when 'variavel' then 'variable' when 'variável' then 'variable' when 'variable' then 'variable'
      else 'none' end;

    v_payee := null;
    if nullif(btrim(coalesce(v_row ->> 'payee', '')), '') is not null then
      select id into v_payee from public.fin_counterparties
      where organization_id = v_org and public.fin_normalize(name) = public.fin_normalize(v_row ->> 'payee')
      limit 1;
      if v_payee is null then
        v_payee := public.app_fin_save_counterparty(
          jsonb_build_object('name', btrim(v_row ->> 'payee'),
                             'kind', case when v_row ->> 'payee_kind' in ('supplier', 'client', 'owner', 'tenant', 'broker', 'partner', 'government', 'bank', 'other', 'employee') then v_row ->> 'payee_kind' else 'supplier' end),
          null, jsonb_build_object('origem', 'importação de documentos', 'lote', v_batch)
        );
      end if;
    end if;

    v_ids := v_ids || public.app_fin_quick_entry(
      jsonb_build_object(
        'kind', v_resolved.kind,
        'description', v_row ->> 'description',
        'amount', v_row ->> 'amount',
        'category_id', v_resolved.category_id,
        'date', v_row ->> 'date',
        'due_date', v_row ->> 'due_date',
        'paid', v_paid,
        'paid_on', coalesce(nullif(v_row ->> 'paid_on', ''), v_row ->> 'date'),
        'account_id', v_resolved.account_id,
        'counterparty_id', v_payee,
        'payment_method', v_row ->> 'payment_method',
        'document_number', v_row ->> 'document_number',
        'notes', concat_ws(' · ', nullif(v_row ->> 'notes', ''), 'Importado de documento: ' || coalesce(p_label, 'lote')),
        'recurring', v_recurring,
        'import_batch_id', v_batch
      ),
      jsonb_build_object('origem', 'importação de documentos', 'lote', v_batch, 'rotulo', p_label)
    );
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'count', coalesce(array_length(v_ids, 1), 0), 'entry_ids', to_jsonb(v_ids));
end;
$$;

-- Desfaz um lote importado: cancela os lançamentos (estornando o razão) e
-- encerra recorrências criadas por ele.
create or replace function public.fin_admin_cancel_import_batch(p_user_email text, p_batch_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_entry record;
  v_count integer := 0;
begin
  select i.organization_id into v_org from public.fin_admin_impersonate(p_user_email) i;
  perform public.fin_require('write');
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;
  for v_entry in
    select id, recurrence_id from public.fin_entries
    where organization_id = v_org and import_batch_id = p_batch_id and cancelled_at is null
  loop
    perform public.fin_cancel_entry_internal(v_entry.id, p_reason);
    if v_entry.recurrence_id is not null then
      update public.fin_recurrences set is_active = false where id = v_entry.recurrence_id;
      perform public.fin_cancel_future_forecasts(v_entry.recurrence_id, '1900-01-01'::date, 'Lote importado desfeito');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Grants
-- -----------------------------------------------------------------------------
grant execute on function
  public.fin_recurrence_estimate(uuid),
  public.app_fin_set_recurrence_value_mode(uuid, text, jsonb),
  public.app_fin_pay_occurrence(uuid, jsonb, jsonb),
  public.app_fin_quick_entry(jsonb, jsonb),
  public.fin_report_year_cards(integer),
  public.fin_commission_receipts(uuid[])
to authenticated;

revoke all on function
  public.fin_admin_resolve_import(uuid, jsonb),
  public.fin_admin_impersonate(text),
  public.fin_admin_preview_import(text, jsonb),
  public.fin_admin_import_entries(text, jsonb, text),
  public.fin_admin_cancel_import_batch(text, uuid, text)
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function
      public.fin_admin_preview_import(text, jsonb),
      public.fin_admin_import_entries(text, jsonb, text),
      public.fin_admin_cancel_import_batch(text, uuid, text)
    to service_role';
  end if;
end
$$;

-- ===================== 0014_finance_month_simple.sql =====================
-- =============================================================================
-- 0014 — Controle mensal simplificado
--
-- * Conta padrão: quem só quer cadastrar saídas não precisa criar conta antes.
--   A primeira vez que algo é pago/recebido, criamos "Conta da imobiliária".
-- * Parar de repetir uma saída recorrente com um clique (cancela as previsões
--   futuras ainda não pagas e encerra a recorrência).
-- =============================================================================

create or replace function public.app_fin_default_account(p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('write');
  v_id  uuid;
begin
  perform public.set_audit_metadata(p_metadata);
  select id into v_id from public.fin_accounts
  where organization_id = v_org and is_active
  order by case kind when 'checking' then 0 else 1 end, created_at
  limit 1;
  if v_id is null then
    v_id := public.app_fin_save_account(
      jsonb_build_object('name', 'Conta da imobiliária', 'kind', 'checking', 'opening_balance', 0,
                         'opening_date', public.fin_today()),
      null, p_metadata
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.app_fin_stop_recurrence(p_recurrence_id uuid, p_metadata jsonb default '{}'::jsonb)
returns integer
language plpgsql
as $$
declare
  v_org   uuid := public.fin_require('write');
  v_count integer;
begin
  perform public.set_audit_metadata(p_metadata);
  update public.fin_recurrences set is_active = false
   where id = p_recurrence_id and organization_id = v_org;
  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'CF005';
  end if;
  with cancelled as (
    update public.fin_entries
       set cancelled_at = now(), cancelled_by = public.current_profile_id(),
           cancel_reason = 'Parou de repetir', status = 'cancelled'
     where recurrence_id = p_recurrence_id and status = 'forecast' and settled_amount = 0
    returning 1
  )
  select count(*)::integer into v_count from cancelled;
  return v_count;
end;
$$;

grant execute on function
  public.app_fin_default_account(jsonb),
  public.app_fin_stop_recurrence(uuid, jsonb)
to authenticated;

