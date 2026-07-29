-- =============================================================================
-- Central Financeira — 0003 · Motor financeiro no banco (fonte única da verdade)
--
-- As mesmas fórmulas existem em lib/finance/engine.ts. Qualquer alteração aqui
-- precisa ser refletida lá e coberta por tests/unit/finance.spec.ts.
--
-- Ordem de arredondamento (obrigatória):
--   1. comissão bruta  -> 2 casas
--   2. cada repasse    -> 2 casas (calculado sobre a bruta já arredondada)
--   3. soma dos repasses já arredondados
--   4. receita líquida -> 2 casas
-- =============================================================================

-- round() de numeric no PostgreSQL arredonda meio para longe do zero
-- (equivalente a ROUND_HALF_UP para valores positivos), igual ao decimal.js.
create or replace function public.fin_money(p_value numeric)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p_value, 0)::numeric, 2);
$$;

create or replace function public.fin_gross_commission(
  p_mode  public.amount_mode,
  p_base  numeric,
  p_rate  numeric,
  p_fixed numeric
)
returns numeric
language sql
immutable
as $$
  select public.fin_money(
    case
      when p_mode = 'fixed' then coalesce(p_fixed, 0)
      else coalesce(p_base, 0) * coalesce(p_rate, 0) / 100
    end
  );
$$;

create or replace function public.fin_split_amount(
  p_mode  public.amount_mode,
  p_gross numeric,
  p_rate  numeric,
  p_fixed numeric
)
returns numeric
language sql
immutable
as $$
  select public.fin_money(
    case
      when p_mode = 'fixed' then coalesce(p_fixed, 0)
      else coalesce(p_gross, 0) * coalesce(p_rate, 0) / 100
    end
  );
$$;

-- Margem líquida em pontos percentuais; null quando não há base de cálculo.
create or replace function public.fin_net_margin(p_net numeric, p_gross numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_gross, 0) = 0 then null
    else round(p_net / p_gross * 100, 4)
  end;
$$;

-- -----------------------------------------------------------------------------
-- Repasses com valor calculado
-- -----------------------------------------------------------------------------
drop view if exists public.entry_split_amounts cascade;
create view public.entry_split_amounts
with (security_invoker = true) as
select
  s.id              as split_id,
  s.organization_id,
  s.entry_id,
  s.broker_id,
  b.full_name       as broker_name,
  b.short_name      as broker_short_name,
  b.is_active       as broker_is_active,
  s.split_mode,
  s.split_rate,
  s.split_fixed_amount,
  public.fin_split_amount(
    s.split_mode,
    public.fin_gross_commission(e.commission_mode, e.base_amount, e.commission_rate, e.commission_fixed_amount),
    s.split_rate,
    s.split_fixed_amount
  ) as payout_amount,
  e.entry_type,
  e.entry_date,
  e.base_amount,
  e.deleted_at      as entry_deleted_at,
  s.deleted_at
from public.entry_broker_splits s
join public.financial_entries e on e.id = s.entry_id
join public.brokers b on b.id = s.broker_id;

-- -----------------------------------------------------------------------------
-- Totais por lançamento
-- -----------------------------------------------------------------------------
drop view if exists public.financial_entry_totals cascade;
create view public.financial_entry_totals
with (security_invoker = true) as
select
  e.id                as entry_id,
  e.organization_id,
  e.entry_type,
  e.entry_date,
  e.entry_year        as year,
  e.entry_month       as month,
  to_char(e.entry_date, 'YYYY-MM') as period_key,
  e.description,
  e.reference,
  e.property_type,
  e.base_amount,
  e.commission_mode,
  e.commission_rate,
  e.commission_fixed_amount,
  g.gross_commission,
  coalesce(sp.total_broker_payout, 0)                        as total_broker_payout,
  public.fin_money(g.gross_commission - coalesce(sp.total_broker_payout, 0)) as net_company_revenue,
  public.fin_net_margin(
    public.fin_money(g.gross_commission - coalesce(sp.total_broker_payout, 0)),
    g.gross_commission
  )                                                          as net_margin,
  coalesce(sp.broker_count, 0)::integer                      as broker_count,
  sp.broker_names,
  sp.broker_ids,
  e.notes,
  e.exception_confirmed,
  e.exception_reason,
  e.import_id,
  e.created_by,
  e.updated_by,
  e.created_at,
  e.updated_at,
  e.deleted_at,
  e.deleted_by,
  e.deletion_reason
from public.financial_entries e
cross join lateral (
  select public.fin_gross_commission(
    e.commission_mode, e.base_amount, e.commission_rate, e.commission_fixed_amount
  ) as gross_commission
) g
left join lateral (
  select
    sum(public.fin_split_amount(s.split_mode, g.gross_commission, s.split_rate, s.split_fixed_amount)) as total_broker_payout,
    count(*)                                                  as broker_count,
    array_agg(coalesce(b.short_name, b.full_name) order by b.full_name) as broker_names,
    array_agg(b.id order by b.full_name)                      as broker_ids
  from public.entry_broker_splits s
  join public.brokers b on b.id = s.broker_id
  where s.entry_id = e.id
    and s.deleted_at is null
) sp on true;

-- -----------------------------------------------------------------------------
-- Resumo mensal consolidado
-- -----------------------------------------------------------------------------
drop view if exists public.monthly_financial_summary cascade;
create view public.monthly_financial_summary
with (security_invoker = true) as
select
  t.organization_id,
  t.year,
  t.month,
  to_char(make_date(t.year, t.month, 1), 'YYYY-MM')                            as period_key,
  public.fin_money(sum(t.base_amount) filter (where t.entry_type = 'sale'))    as sales_base_amount,
  public.fin_money(sum(t.gross_commission) filter (where t.entry_type = 'sale')) as sales_gross_commission,
  public.fin_money(sum(t.net_company_revenue) filter (where t.entry_type = 'sale')) as sales_net_revenue,
  public.fin_money(sum(t.base_amount) filter (where t.entry_type = 'rental'))  as rental_base_amount,
  public.fin_money(sum(t.gross_commission) filter (where t.entry_type = 'rental')) as rental_gross_commission,
  public.fin_money(sum(t.net_company_revenue) filter (where t.entry_type = 'rental')) as rental_net_revenue,
  public.fin_money(sum(t.gross_commission))                                    as total_gross_commission,
  public.fin_money(sum(t.total_broker_payout))                                 as total_broker_payout,
  public.fin_money(sum(t.net_company_revenue))                                 as total_net_revenue,
  count(*) filter (where t.entry_type = 'sale')::integer                       as sales_count,
  count(*) filter (where t.entry_type = 'rental')::integer                     as rental_count,
  count(*)::integer                                                            as entries_count,
  public.fin_money(sum(t.gross_commission) / nullif(count(*), 0))              as average_gross_commission,
  round(
    sum(t.gross_commission) filter (where t.entry_type = 'sale')
      / nullif(sum(t.base_amount) filter (where t.entry_type = 'sale'), 0) * 100,
    4
  )                                                                            as weighted_sale_commission_rate,
  round(
    sum(t.total_broker_payout) / nullif(sum(t.gross_commission), 0) * 100, 4
  )                                                                            as average_broker_payout_rate,
  public.fin_net_margin(sum(t.net_company_revenue), sum(t.gross_commission))   as net_margin
from public.financial_entry_totals t
where t.deleted_at is null
group by t.organization_id, t.year, t.month;

comment on view public.financial_entry_totals is
  'Totais calculados por lançamento. Fonte única da verdade — não recalcular fórmulas fora daqui.';
comment on view public.monthly_financial_summary is
  'Agregação mensal derivada de financial_entry_totals (lançamentos não excluídos).';
