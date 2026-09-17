-- =============================================================================
-- Central Financeira — 0009 · Obras: pagamento de itens, status rápido e
-- histórico completo
--
-- Marcação pago/não pago (+ data) nos lançamentos da obra. Não é "contas a
-- pagar": não há vencimento, cobrança ou baixa bancária — apenas o registro de
-- que aquele item já foi quitado, para o resumo da obra e o relatório em PDF.
-- =============================================================================

alter table public.work_entries
  add column if not exists is_paid boolean not null default false,
  add column if not exists paid_at date;

alter table public.work_entries drop constraint if exists work_entries_paid_ck;
alter table public.work_entries add constraint work_entries_paid_ck
  check (is_paid = false or paid_at is not null);

create index if not exists work_entries_org_unpaid_idx
  on public.work_entries (organization_id)
  where deleted_at is null and is_paid = false;

-- -----------------------------------------------------------------------------
-- Ações novas no histórico legível
-- -----------------------------------------------------------------------------
alter table public.work_activities drop constraint if exists work_activities_action_check;
alter table public.work_activities add constraint work_activities_action_check check (action in (
  'obra_criada', 'status_alterado', 'item_adicionado', 'item_editado', 'item_removido',
  'item_pago', 'documento_enviado', 'foto_adicionada', 'anexo_removido', 'obra_concluida',
  'obra_arquivada', 'obra_reaberta'
));

-- -----------------------------------------------------------------------------
-- Lançamentos: agora com is_paid / paid_at e histórico de edição/pagamento
-- -----------------------------------------------------------------------------
create or replace function public.app_save_work_entry(
  p_payload       jsonb,
  p_work_entry_id uuid default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org         uuid := public.app_require_org();
  v_profile     uuid := public.current_profile_id();
  v_work_id     uuid := (p_payload ->> 'work_id')::uuid;
  v_entry_id    uuid := p_work_entry_id;
  v_description text := btrim(coalesce(p_payload ->> 'description', ''));
  v_quantity    numeric := (p_payload ->> 'quantity')::numeric;
  v_unit_price  numeric := (p_payload ->> 'unit_price')::numeric;
  v_manual      boolean := coalesce((p_payload ->> 'total_is_manual')::boolean, false);
  v_is_paid     boolean := coalesce((p_payload ->> 'is_paid')::boolean, false);
  v_paid_at     date;
  v_was_paid    boolean;
  v_total       numeric;
begin
  perform public.set_audit_metadata(p_metadata);

  if length(v_description) = 0 then
    raise exception 'Descreva o item.' using errcode = 'CF002';
  end if;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero.' using errcode = 'CF002';
  end if;
  if v_unit_price is null or v_unit_price < 0 then
    raise exception 'Informe um valor unitário válido.' using errcode = 'CF002';
  end if;
  if not exists (select 1 from public.works w where w.id = v_work_id and w.organization_id = v_org) then
    raise exception 'Obra não encontrada.' using errcode = 'CF005';
  end if;

  v_total := case
    when v_manual then round(coalesce((p_payload ->> 'total_amount')::numeric, 0), 2)
    else round(v_quantity * v_unit_price, 2)
  end;

  v_paid_at := case
    when v_is_paid then coalesce(nullif(p_payload ->> 'paid_at', '')::date, current_date)
    else null
  end;

  if v_entry_id is null then
    insert into public.work_entries (
      organization_id, work_id, entry_type, entry_date, description, category, supplier_name,
      quantity, unit, unit_price, total_amount, total_is_manual, is_paid, paid_at, notes,
      created_by, updated_by
    )
    values (
      v_org, v_work_id, p_payload ->> 'entry_type', (p_payload ->> 'entry_date')::date,
      v_description, nullif(btrim(coalesce(p_payload ->> 'category', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'supplier_name', '')), ''),
      v_quantity, coalesce(p_payload ->> 'unit', 'unidade'), v_unit_price, v_total, v_manual,
      v_is_paid, v_paid_at,
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
    )
    returning id into v_entry_id;

    perform public.app_log_work_activity(v_work_id, 'item_adicionado', 'Item adicionado: ' || v_description);
    if v_is_paid then
      perform public.app_log_work_activity(
        v_work_id, 'item_pago',
        'Pagamento registrado: ' || v_description || ' — R$ ' || replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      );
    end if;
  else
    select is_paid into v_was_paid
      from public.work_entries
     where id = v_entry_id and work_id = v_work_id and organization_id = v_org and deleted_at is null;

    if not found then
      raise exception 'Item não encontrado.' using errcode = 'CF005';
    end if;

    update public.work_entries
       set entry_type      = p_payload ->> 'entry_type',
           entry_date      = (p_payload ->> 'entry_date')::date,
           description     = v_description,
           category        = nullif(btrim(coalesce(p_payload ->> 'category', '')), ''),
           supplier_name   = nullif(btrim(coalesce(p_payload ->> 'supplier_name', '')), ''),
           quantity        = v_quantity,
           unit            = coalesce(p_payload ->> 'unit', 'unidade'),
           unit_price      = v_unit_price,
           total_amount    = v_total,
           total_is_manual = v_manual,
           is_paid         = v_is_paid,
           paid_at         = v_paid_at,
           notes           = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           updated_by      = v_profile
     where id = v_entry_id;

    perform public.app_log_work_activity(v_work_id, 'item_editado', 'Item editado: ' || v_description);
    if v_is_paid and not coalesce(v_was_paid, false) then
      perform public.app_log_work_activity(
        v_work_id, 'item_pago',
        'Pagamento registrado: ' || v_description || ' — R$ ' || replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      );
    end if;
  end if;

  return v_entry_id;
end;
$$;

-- Marcar/desmarcar pago direto na tabela, sem reenviar o item inteiro.
create or replace function public.app_set_work_entry_paid(
  p_work_entry_id uuid,
  p_is_paid       boolean,
  p_paid_at       date default null,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org      uuid := public.app_require_org();
  v_work_id  uuid;
  v_desc     text;
  v_total    numeric;
begin
  perform public.set_audit_metadata(p_metadata);

  update public.work_entries
     set is_paid    = p_is_paid,
         paid_at    = case when p_is_paid then coalesce(p_paid_at, current_date) else null end,
         updated_by = public.current_profile_id()
   where id = p_work_entry_id and organization_id = v_org and deleted_at is null
   returning work_id, description, total_amount into v_work_id, v_desc, v_total;

  if not found then
    raise exception 'Item não encontrado.' using errcode = 'CF005';
  end if;

  if p_is_paid then
    perform public.app_log_work_activity(
      v_work_id, 'item_pago',
      'Pagamento registrado: ' || v_desc || ' — R$ ' || replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
    );
  else
    perform public.app_log_work_activity(v_work_id, 'item_editado', 'Pagamento desmarcado: ' || v_desc);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status rápido (sem reenviar a obra inteira)
-- -----------------------------------------------------------------------------
create or replace function public.app_update_work_status(
  p_work_id  uuid,
  p_status   text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org        uuid := public.app_require_org();
  v_old_status text;
begin
  perform public.set_audit_metadata(p_metadata);

  select status into v_old_status
    from public.works
   where id = p_work_id and organization_id = v_org and is_archived = false;

  if not found then
    raise exception 'Obra não encontrada.' using errcode = 'CF005';
  end if;

  if v_old_status = p_status then
    return;
  end if;

  update public.works
     set status       = p_status,
         completed_at = case
           when p_status = 'concluida' and completed_at is null then current_date
           else completed_at
         end,
         updated_by   = public.current_profile_id()
   where id = p_work_id;

  perform public.app_log_work_activity(
    p_work_id, 'status_alterado',
    'Status alterado de ' || v_old_status || ' para ' || p_status
  );

  if p_status = 'concluida' then
    perform public.app_log_work_activity(p_work_id, 'obra_concluida', 'Obra marcada como concluída.');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reabrir e remover anexo passam a aparecer no histórico
-- -----------------------------------------------------------------------------
create or replace function public.app_unarchive_work(
  p_work_id  uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  perform public.set_audit_metadata(p_metadata);

  update public.works
     set is_archived = false, archived_at = null, archived_by = null, archived_reason = null,
         updated_by = public.current_profile_id()
   where id = p_work_id and organization_id = v_org and is_archived = true;

  if not found then
    raise exception 'Obra não encontrada na lista de arquivadas.' using errcode = 'CF005';
  end if;

  perform public.app_log_work_activity(p_work_id, 'obra_reaberta', 'Obra reaberta.');
end;
$$;

create or replace function public.app_delete_work_attachment(
  p_attachment_id uuid,
  p_metadata      jsonb default '{}'::jsonb
)
returns text
language plpgsql
as $$
declare
  v_org     uuid := public.app_require_org();
  v_path    text;
  v_work_id uuid;
  v_name    text;
begin
  perform public.set_audit_metadata(p_metadata);

  update public.work_attachments
     set deleted_at = now()
   where id = p_attachment_id and organization_id = v_org and deleted_at is null
   returning storage_path, work_id, file_name into v_path, v_work_id, v_name;

  if not found then
    raise exception 'Anexo não encontrado.' using errcode = 'CF005';
  end if;

  perform public.app_log_work_activity(v_work_id, 'anexo_removido', 'Anexo removido: ' || v_name);

  return v_path;
end;
$$;

grant execute on function
  public.app_set_work_entry_paid(uuid, boolean, date, jsonb),
  public.app_update_work_status(uuid, text, jsonb)
to authenticated;
