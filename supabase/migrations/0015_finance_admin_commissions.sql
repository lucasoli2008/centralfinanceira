-- =============================================================================
-- 0015 — Marcar em lote comissões (vendas/locações) como recebidas
--
-- Uso administrativo (só service_role): executa, em nome do usuário informado,
-- a mesma RPC do botão "Recebido" (app_fin_register_commission_receipt) para
-- cada comissão com data até p_until que ainda não entrou no caixa. A data de
-- recebimento é a data da própria comissão. Comissões com exceção financeira
-- (repasses maiores que a comissão) ficam de fora e são listadas no retorno.
-- =============================================================================

create or replace function public.fin_admin_mark_commissions_received(
  p_user_email   text,
  p_until        date,
  p_account_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_account uuid;
  v_row     record;
  v_count   integer := 0;
  v_total   numeric := 0;
  v_skipped jsonb := '[]'::jsonb;
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
    select t.entry_id, t.entry_date, t.description, t.gross_commission, t.net_company_revenue, t.exception_confirmed
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
    perform public.app_fin_register_commission_receipt(
      v_row.entry_id,
      jsonb_build_object('account_id', v_account, 'received_on', v_row.entry_date),
      jsonb_build_object('origem', 'marcação em lote', 'ate', p_until)
    );
    v_count := v_count + 1;
    v_total := v_total + v_row.gross_commission;
  end loop;

  return jsonb_build_object('count', v_count, 'gross_total', v_total, 'skipped', v_skipped);
end;
$$;

revoke all on function public.fin_admin_mark_commissions_received(text, date, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.fin_admin_mark_commissions_received(text, date, text) to service_role';
  end if;
end
$$;
