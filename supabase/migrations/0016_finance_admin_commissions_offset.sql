-- =============================================================================
-- 0016 — Recebimento em lote com prazo por tipo
--
-- Substitui a função da 0015: a data de recebimento passa a ser a data da
-- comissão + N dias, configurável por tipo (locação e venda). Sem data real de
-- recebimento dos meses anteriores, a imobiliária usa: locação = cadastro + 15
-- dias; venda = mesmo dia.
-- =============================================================================

drop function if exists public.fin_admin_mark_commissions_received(text, date, text);

create or replace function public.fin_admin_mark_commissions_received(
  p_user_email          text,
  p_until               date,
  p_account_name        text default null,
  p_rental_offset_days  integer default 0,
  p_sale_offset_days    integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_account  uuid;
  v_row      record;
  v_count    integer := 0;
  v_total    numeric := 0;
  v_skipped  jsonb := '[]'::jsonb;
  v_received date;
begin
  select i.organization_id into v_org from public.fin_admin_impersonate(p_user_email) i;

  select id into v_account from public.fin_accounts
  where organization_id = v_org and is_active
    and (p_account_name is null or public.fin_normalize(name) = public.fin_normalize(p_account_name))
  order by case kind when 'checking' then 0 else 1 end, created_at
  limit 1;
  if v_account is null then
    raise exception 'Nenhuma conta encontrada para registrar os recebimentos.' using errcode = 'CF005';
  end if;

  for v_row in
    select t.entry_id, t.entry_type, t.entry_date, t.description, t.gross_commission,
           t.net_company_revenue, t.exception_confirmed
    from public.financial_entry_totals t
    where t.organization_id = v_org
      and t.deleted_at is null
      and t.entry_date <= p_until
      and t.gross_commission > 0
      and not exists (
        select 1 from public.fin_operations o
        where o.commission_entry_id = t.entry_id and o.cancelled_at is null
      )
    order by t.entry_date
  loop
    if v_row.exception_confirmed or v_row.net_company_revenue < 0 then
      v_skipped := v_skipped || jsonb_build_object('entry_id', v_row.entry_id, 'description', v_row.description);
      continue;
    end if;
    v_received := v_row.entry_date
      + case when v_row.entry_type::text = 'rental' then coalesce(p_rental_offset_days, 0) else coalesce(p_sale_offset_days, 0) end;
    perform public.app_fin_register_commission_receipt(
      v_row.entry_id,
      jsonb_build_object('account_id', v_account, 'received_on', v_received),
      jsonb_build_object('origem', 'marcação em lote', 'ate', p_until)
    );
    v_count := v_count + 1;
    v_total := v_total + v_row.gross_commission;
  end loop;

  return jsonb_build_object('count', v_count, 'gross_total', v_total, 'skipped', v_skipped);
end;
$$;

revoke all on function public.fin_admin_mark_commissions_received(text, date, text, integer, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fin_admin_mark_commissions_received(text, date, text, integer, integer) to service_role';
  end if;
end
$$;
