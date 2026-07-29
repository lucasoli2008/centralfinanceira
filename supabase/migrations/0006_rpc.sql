-- =============================================================================
-- Central Financeira — 0006 · Operações transacionais (RPC)
--
-- Todas as funções são SECURITY INVOKER: as políticas de RLS continuam valendo.
-- A organização NUNCA vem do cliente — é derivada de app_current_org().
-- =============================================================================

-- Contexto de auditoria da transação atual (IP, navegador, justificativas).
-- Escopo local: vale apenas para a transação da própria RPC.
create or replace function public.set_audit_metadata(p_metadata jsonb)
returns void
language sql
as $$
  select set_config('app.audit_metadata', coalesce(p_metadata, '{}'::jsonb)::text, true);
$$;

create or replace function public.app_require_org()
returns uuid
language plpgsql
stable
as $$
declare
  v_org uuid;
begin
  v_org := public.app_current_org();
  if v_org is null then
    raise exception 'Seu usuário não está vinculado a uma organização ativa.'
      using errcode = 'CF004';
  end if;
  return v_org;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançamentos: criação e edição em uma única transação
-- -----------------------------------------------------------------------------
create or replace function public.app_save_entry(
  p_payload  jsonb,
  p_entry_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org        uuid := public.app_require_org();
  v_profile    uuid := public.current_profile_id();
  v_entry_id   uuid := p_entry_id;
  v_mode       public.amount_mode := (p_payload ->> 'commission_mode')::public.amount_mode;
  v_gross      numeric;
  v_payout     numeric := 0;
  v_split      jsonb;
  v_broker_ids uuid[] := '{}';
  v_broker_id  uuid;
  v_confirmed  boolean := coalesce((p_payload ->> 'exception_confirmed')::boolean, false);
  v_reason     text := nullif(btrim(coalesce(p_payload ->> 'exception_reason', '')), '');
begin
  perform public.set_audit_metadata(p_metadata);

  -- Comissão bruta segundo as mesmas fórmulas das views ------------------------
  v_gross := public.fin_gross_commission(
    v_mode,
    (p_payload ->> 'base_amount')::numeric,
    (p_payload ->> 'commission_rate')::numeric,
    (p_payload ->> 'commission_fixed_amount')::numeric
  );

  -- Soma dos repasses (cada um arredondado individualmente) ---------------------
  for v_split in select * from jsonb_array_elements(coalesce(p_payload -> 'splits', '[]'::jsonb))
  loop
    v_broker_id := (v_split ->> 'broker_id')::uuid;

    if v_broker_id is null then
      raise exception 'Selecione o corretor do repasse.' using errcode = 'CF002';
    end if;

    if v_broker_id = any (v_broker_ids) then
      raise exception 'Este corretor já foi adicionado ao lançamento.' using errcode = 'CF003';
    end if;

    if not exists (
      select 1 from public.brokers b where b.id = v_broker_id and b.organization_id = v_org
    ) then
      raise exception 'Corretor não encontrado nesta organização.' using errcode = 'CF005';
    end if;

    v_broker_ids := v_broker_ids || v_broker_id;

    v_payout := v_payout + public.fin_split_amount(
      (v_split ->> 'split_mode')::public.amount_mode,
      v_gross,
      (v_split ->> 'split_rate')::numeric,
      (v_split ->> 'split_fixed_amount')::numeric
    );
  end loop;

  -- Exceção financeira ---------------------------------------------------------
  if v_payout > v_gross then
    if not v_confirmed then
      raise exception 'A soma dos repasses aos corretores é maior que a comissão bruta. Isso fará com que a receita líquida da imobiliária fique negativa.'
        using errcode = 'CF002';
    end if;
    if v_reason is null or length(v_reason) < 10 then
      raise exception 'Informe uma justificativa com pelo menos 10 caracteres para confirmar a exceção financeira.'
        using errcode = 'CF002';
    end if;
  else
    -- Sem excesso não há exceção a registrar.
    v_confirmed := false;
    v_reason := null;
  end if;

  -- Gravação -------------------------------------------------------------------
  if v_entry_id is null then
    insert into public.financial_entries (
      organization_id, entry_type, entry_date, description, reference, property_type,
      base_amount, commission_mode, commission_rate, commission_fixed_amount, notes,
      exception_confirmed, exception_reason, import_id, created_by, updated_by
    )
    values (
      v_org,
      (p_payload ->> 'entry_type')::public.entry_type,
      (p_payload ->> 'entry_date')::date,
      btrim(p_payload ->> 'description'),
      nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''),
      coalesce((p_payload ->> 'property_type')::public.property_type, 'residential'),
      (p_payload ->> 'base_amount')::numeric,
      v_mode,
      (p_payload ->> 'commission_rate')::numeric,
      (p_payload ->> 'commission_fixed_amount')::numeric,
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
      v_confirmed,
      v_reason,
      (p_payload ->> 'import_id')::uuid,
      v_profile,
      v_profile
    )
    returning id into v_entry_id;
  else
    update public.financial_entries
       set entry_type              = (p_payload ->> 'entry_type')::public.entry_type,
           entry_date              = (p_payload ->> 'entry_date')::date,
           description             = btrim(p_payload ->> 'description'),
           reference               = nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''),
           property_type           = coalesce((p_payload ->> 'property_type')::public.property_type, 'residential'),
           base_amount             = (p_payload ->> 'base_amount')::numeric,
           commission_mode         = v_mode,
           commission_rate         = (p_payload ->> 'commission_rate')::numeric,
           commission_fixed_amount = (p_payload ->> 'commission_fixed_amount')::numeric,
           notes                   = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           exception_confirmed     = v_confirmed,
           exception_reason        = v_reason,
           updated_by              = v_profile
     where id = v_entry_id
       and organization_id = v_org
       and deleted_at is null;

    if not found then
      raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
    end if;
  end if;

  -- Repasses: remove os que saíram, atualiza os mantidos, insere os novos -------
  update public.entry_broker_splits
     set deleted_at = now(), updated_by = v_profile
   where entry_id = v_entry_id
     and deleted_at is null
     and (v_broker_ids = '{}' or broker_id <> all (v_broker_ids));

  for v_split in select * from jsonb_array_elements(coalesce(p_payload -> 'splits', '[]'::jsonb))
  loop
    v_broker_id := (v_split ->> 'broker_id')::uuid;

    update public.entry_broker_splits
       set split_mode         = (v_split ->> 'split_mode')::public.amount_mode,
           split_rate         = (v_split ->> 'split_rate')::numeric,
           split_fixed_amount = (v_split ->> 'split_fixed_amount')::numeric,
           updated_by         = v_profile
     where entry_id = v_entry_id
       and broker_id = v_broker_id
       and deleted_at is null;

    if not found then
      insert into public.entry_broker_splits (
        organization_id, entry_id, broker_id, split_mode, split_rate, split_fixed_amount,
        created_by, updated_by
      )
      values (
        v_org, v_entry_id, v_broker_id,
        (v_split ->> 'split_mode')::public.amount_mode,
        (v_split ->> 'split_rate')::numeric,
        (v_split ->> 'split_fixed_amount')::numeric,
        v_profile, v_profile
      );
    end if;
  end loop;

  if v_confirmed then
    perform public.write_audit_log(
      v_org, 'financial_exception_confirmed', 'financial_entries', v_entry_id,
      null,
      jsonb_build_object('gross_commission', v_gross, 'total_broker_payout', v_payout),
      jsonb_build_object('justificativa', v_reason)
    );
  end if;

  return v_entry_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Exclusão lógica e restauração
-- -----------------------------------------------------------------------------
create or replace function public.app_delete_entry(
  p_entry_id uuid,
  p_reason   text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  perform public.set_audit_metadata(
    coalesce(p_metadata, '{}'::jsonb)
    || case when p_reason is null then '{}'::jsonb else jsonb_build_object('motivo', p_reason) end
  );

  update public.financial_entries
     set deleted_at      = now(),
         deleted_by      = public.current_profile_id(),
         deletion_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_by      = public.current_profile_id()
   where id = p_entry_id
     and organization_id = v_org
     and deleted_at is null;

  if not found then
    raise exception 'Lançamento não encontrado.' using errcode = 'CF005';
  end if;
end;
$$;

create or replace function public.app_restore_entry(
  p_entry_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  perform public.set_audit_metadata(p_metadata);

  update public.financial_entries
     set deleted_at      = null,
         deleted_by      = null,
         deletion_reason = null,
         updated_by      = public.current_profile_id()
   where id = p_entry_id
     and organization_id = v_org
     and deleted_at is not null;

  if not found then
    raise exception 'Lançamento não encontrado na lixeira.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fechamento mensal
-- -----------------------------------------------------------------------------
create or replace function public.app_close_month(
  p_year     integer,
  p_month    integer,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org     uuid := public.app_require_org();
  v_enabled boolean;
begin
  perform public.set_audit_metadata(p_metadata);

  select monthly_closing_enabled into v_enabled
  from public.organization_settings where organization_id = v_org;

  if coalesce(v_enabled, true) = false then
    raise exception 'O fechamento mensal está desativado nas configurações.' using errcode = 'CF004';
  end if;

  insert into public.monthly_closings (organization_id, year, month, status, closed_by, closed_at)
  values (v_org, p_year, p_month, 'closed', public.current_profile_id(), now())
  on conflict (organization_id, year, month) do update
    set status        = 'closed',
        closed_by     = public.current_profile_id(),
        closed_at     = now(),
        reopened_by   = null,
        reopened_at   = null,
        reopen_reason = null;
end;
$$;

create or replace function public.app_reopen_month(
  p_year     integer,
  p_month    integer,
  p_reason   text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  perform public.set_audit_metadata(
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason)
  );

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe uma justificativa com pelo menos 10 caracteres para reabrir o mês.'
      using errcode = 'CF002';
  end if;

  update public.monthly_closings
     set status        = 'open',
         reopened_by   = public.current_profile_id(),
         reopened_at   = now(),
         reopen_reason = btrim(p_reason)
   where organization_id = v_org
     and year = p_year
     and month = p_month
     and status = 'closed';

  if not found then
    raise exception 'Este mês não está fechado.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Corretores
-- -----------------------------------------------------------------------------
create or replace function public.app_save_broker(
  p_payload   jsonb,
  p_broker_id uuid default null,
  p_metadata  jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org       uuid := public.app_require_org();
  v_profile   uuid := public.current_profile_id();
  v_broker_id uuid := p_broker_id;
  v_name      text := btrim(p_payload ->> 'full_name');
begin
  perform public.set_audit_metadata(p_metadata);

  if v_name is null or length(v_name) = 0 then
    raise exception 'Informe o nome do corretor.' using errcode = 'CF002';
  end if;

  -- Dois corretores ativos com o mesmo nome exigem confirmação explícita.
  if coalesce((p_payload ->> 'confirm_duplicate_name')::boolean, false) = false
     and coalesce((p_payload ->> 'is_active')::boolean, true)
     and exists (
       select 1 from public.brokers b
       where b.organization_id = v_org
         and b.is_active
         and public.normalized_name(b.full_name) = public.normalized_name(v_name)
         and (v_broker_id is null or b.id <> v_broker_id)
     ) then
    raise exception 'Já existe um corretor ativo com este nome. Confirme para cadastrar mesmo assim.'
      using errcode = 'CF003';
  end if;

  if v_broker_id is null then
    insert into public.brokers (
      organization_id, full_name, short_name, email, phone, document_number,
      default_split_mode, default_split_rate, default_split_fixed_amount, is_active,
      created_by, updated_by
    )
    values (
      v_org, v_name,
      nullif(btrim(coalesce(p_payload ->> 'short_name', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'document_number', '')), ''),
      coalesce((p_payload ->> 'default_split_mode')::public.amount_mode, 'percentage'),
      (p_payload ->> 'default_split_rate')::numeric,
      (p_payload ->> 'default_split_fixed_amount')::numeric,
      coalesce((p_payload ->> 'is_active')::boolean, true),
      v_profile, v_profile
    )
    returning id into v_broker_id;
  else
    update public.brokers
       set full_name                  = v_name,
           short_name                 = nullif(btrim(coalesce(p_payload ->> 'short_name', '')), ''),
           email                      = nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
           phone                      = nullif(btrim(coalesce(p_payload ->> 'phone', '')), ''),
           document_number            = nullif(btrim(coalesce(p_payload ->> 'document_number', '')), ''),
           default_split_mode         = coalesce((p_payload ->> 'default_split_mode')::public.amount_mode, 'percentage'),
           default_split_rate         = (p_payload ->> 'default_split_rate')::numeric,
           default_split_fixed_amount = (p_payload ->> 'default_split_fixed_amount')::numeric,
           is_active                  = coalesce((p_payload ->> 'is_active')::boolean, is_active),
           updated_by                 = v_profile
     where id = v_broker_id
       and organization_id = v_org;

    if not found then
      raise exception 'Corretor não encontrado.' using errcode = 'CF005';
    end if;
  end if;

  return v_broker_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Importação da planilha
-- -----------------------------------------------------------------------------
create or replace function public.app_import_entries(
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_org       uuid := public.app_require_org();
  v_import_id uuid;
  v_entry     jsonb;
  v_count     integer := 0;
begin
  perform public.set_audit_metadata(p_metadata);

  insert into public.entry_imports (organization_id, source_filename, metadata, created_by)
  values (
    v_org,
    nullif(btrim(coalesce(p_payload ->> 'source_filename', '')), ''),
    coalesce(p_payload -> 'metadata', '{}'::jsonb),
    public.current_profile_id()
  )
  returning id into v_import_id;

  for v_entry in select * from jsonb_array_elements(coalesce(p_payload -> 'entries', '[]'::jsonb))
  loop
    perform public.app_save_entry(v_entry || jsonb_build_object('import_id', v_import_id));
    v_count := v_count + 1;
  end loop;

  update public.entry_imports set entries_count = v_count where id = v_import_id;

  return jsonb_build_object('import_id', v_import_id, 'entries_count', v_count);
end;
$$;

create or replace function public.app_undo_import(
  p_import_id uuid,
  p_metadata  jsonb default '{}'::jsonb
)
returns integer
language plpgsql
as $$
declare
  v_org   uuid := public.app_require_org();
  v_count integer;
begin
  perform public.set_audit_metadata(p_metadata);

  if not exists (
    select 1 from public.entry_imports i
    where i.id = p_import_id and i.organization_id = v_org and i.undone_at is null
  ) then
    raise exception 'Importação não encontrada ou já desfeita.' using errcode = 'CF005';
  end if;

  with undone as (
    update public.financial_entries
       set deleted_at      = now(),
           deleted_by      = public.current_profile_id(),
           deletion_reason = 'Importação desfeita',
           updated_by      = public.current_profile_id()
     where import_id = p_import_id
       and organization_id = v_org
       and deleted_at is null
    returning 1
  )
  select count(*) into v_count from undone;

  update public.entry_imports
     set undone_at = now(), undone_by = public.current_profile_id()
   where id = p_import_id;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões de execução
-- -----------------------------------------------------------------------------
grant execute on function
  public.app_current_org(),
  public.app_require_org(),
  public.set_audit_metadata(jsonb),
  public.app_save_entry(jsonb, uuid, jsonb),
  public.app_delete_entry(uuid, text, jsonb),
  public.app_restore_entry(uuid, jsonb),
  public.app_close_month(integer, integer, jsonb),
  public.app_reopen_month(integer, integer, text, jsonb),
  public.app_save_broker(jsonb, uuid, jsonb),
  public.app_import_entries(jsonb, jsonb),
  public.app_undo_import(uuid, jsonb)
to authenticated;
