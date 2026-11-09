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
