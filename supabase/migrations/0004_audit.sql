-- =============================================================================
-- Central Financeira — 0004 · Auditoria e bloqueio de mês fechado
--
-- Códigos de erro da aplicação:
--   CF001  mês financeiro fechado
--   CF002  repasses maiores que a comissão bruta sem exceção confirmada
--   CF003  corretor duplicado no mesmo lançamento
--   CF004  operação não permitida para o usuário atual
--   CF005  registro inexistente ou fora da organização
-- =============================================================================

-- Usuário atual com perfil válido (evita violar a FK quando não há sessão).
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.id = auth.uid();
$$;

-- Metadados opcionais do contexto (justificativas, IP, user agent).
-- A aplicação define via: select set_config('app.audit_metadata', '{...}', true);
create or replace function public.current_audit_metadata()
returns jsonb
language plpgsql
stable
as $$
declare
  v_raw text;
begin
  v_raw := current_setting('app.audit_metadata', true);
  if v_raw is null or btrim(v_raw) = '' then
    return '{}'::jsonb;
  end if;
  return v_raw::jsonb;
exception
  when others then
    return '{}'::jsonb;
end;
$$;

-- -----------------------------------------------------------------------------
-- Escrita do log (SECURITY DEFINER: a aplicação nunca insere/edita diretamente)
-- -----------------------------------------------------------------------------
create or replace function public.write_audit_log(
  p_organization_id uuid,
  p_action          text,
  p_entity_type     text,
  p_entity_id       uuid,
  p_before          jsonb,
  p_after           jsonb,
  p_metadata        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    organization_id, user_id, action, entity_type, entity_id, before_data, after_data, metadata
  )
  values (
    p_organization_id,
    public.current_profile_id(),
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    coalesce(p_metadata, '{}'::jsonb) || public.current_audit_metadata()
  );
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_action text;
  v_before jsonb;
  v_after  jsonb;
  v_id     uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after  := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    if v_before ? 'deleted_at' then
      if (v_before ->> 'deleted_at') is null and (v_after ->> 'deleted_at') is not null then
        v_action := 'delete';
      elsif (v_before ->> 'deleted_at') is not null and (v_after ->> 'deleted_at') is null then
        v_action := 'restore';
      else
        v_action := 'update';
      end if;
    else
      v_action := 'update';
    end if;
    if v_before = v_after then
      return new;
    end if;
  else
    v_action := 'hard_delete';
    v_before := to_jsonb(old);
    v_after  := null;
  end if;

  v_org := coalesce((v_after ->> 'organization_id')::uuid, (v_before ->> 'organization_id')::uuid);
  v_id  := coalesce((v_after ->> 'id'), (v_before ->> 'id'))::uuid;

  perform public.write_audit_log(v_org, v_action, tg_table_name, v_id, v_before, v_after);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_entries', 'entry_broker_splits', 'brokers', 'organization_settings',
    'organizations', 'monthly_closings', 'organization_members', 'entry_imports'
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

-- Auditoria é imutável: nenhuma atualização ou exclusão, nem por superusuário
-- via aplicação (a proteção contra o painel administrativo é documentada).
create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Os registros de auditoria não podem ser alterados nem excluídos.'
    using errcode = 'CF004';
end;
$$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.reject_audit_mutation();

-- -----------------------------------------------------------------------------
-- Bloqueio de alterações em meses fechados
-- -----------------------------------------------------------------------------
create or replace function public.assert_month_open()
returns trigger
language plpgsql
as $$
declare
  v_org     uuid;
  v_dates   date[];
  v_date    date;
  v_enabled boolean;
begin
  if tg_table_name = 'financial_entries' then
    if tg_op = 'INSERT' then
      v_org := new.organization_id;
      v_dates := array[new.entry_date];
    elsif tg_op = 'UPDATE' then
      v_org := new.organization_id;
      v_dates := array[new.entry_date, old.entry_date];
    else
      v_org := old.organization_id;
      v_dates := array[old.entry_date];
    end if;
  else
    select e.organization_id, array[e.entry_date]
      into v_org, v_dates
    from public.financial_entries e
    where e.id = coalesce(new.entry_id, old.entry_id);

    -- Exclusão física em cascata: quando o lançamento pai já foi removido na
    -- mesma instrução (ON DELETE CASCADE), esta busca não encontra nada. A
    -- regra de mês fechado já foi validada pelo trigger do próprio
    -- financial_entries antes da cascata — nada a checar aqui.
    if v_org is null then
      return coalesce(new, old);
    end if;
  end if;

  select s.monthly_closing_enabled into v_enabled
  from public.organization_settings s
  where s.organization_id = v_org;

  if coalesce(v_enabled, true) = false then
    return coalesce(new, old);
  end if;

  foreach v_date in array v_dates loop
    if exists (
      select 1
      from public.monthly_closings c
      where c.organization_id = v_org
        and c.year = extract(year from v_date)::integer
        and c.month = extract(month from v_date)::integer
        and c.status = 'closed'
    ) then
      raise exception 'Este mês financeiro está fechado. Reabra o mês antes de realizar alterações.'
        using errcode = 'CF001',
              detail = to_char(v_date, 'MM/YYYY');
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists financial_entries_month_guard on public.financial_entries;
create trigger financial_entries_month_guard
  before insert or update or delete on public.financial_entries
  for each row execute function public.assert_month_open();

drop trigger if exists entry_broker_splits_month_guard on public.entry_broker_splits;
create trigger entry_broker_splits_month_guard
  before insert or update or delete on public.entry_broker_splits
  for each row execute function public.assert_month_open();
