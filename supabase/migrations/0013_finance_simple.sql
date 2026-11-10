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
