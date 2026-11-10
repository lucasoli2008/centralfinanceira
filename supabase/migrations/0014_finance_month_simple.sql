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
