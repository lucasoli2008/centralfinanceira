-- =============================================================================
-- Central Financeira — 0007 · Consultas de relatório (fonte única da verdade)
--
-- Dashboard, listas, visão mensal, relatórios e PDFs usam EXATAMENTE estas
-- funções. Nenhuma tela recalcula agregações por conta própria.
-- =============================================================================

-- Lançamentos filtrados ------------------------------------------------------
create or replace function public.report_entries(
  p_from            date default null,
  p_to              date default null,
  p_entry_type      public.entry_type default null,
  p_broker_id       uuid default null,
  p_property_type   public.property_type default null,
  p_commission_mode public.amount_mode default null,
  p_search          text default null,
  p_only_deleted    boolean default false
)
returns setof public.financial_entry_totals
language sql
stable
as $$
  -- p_only_deleted = false -> apenas lançamentos ativos
  -- p_only_deleted = true  -> apenas a lixeira
  select t.*
  from public.financial_entry_totals t
  where t.organization_id = public.app_current_org()
    and ((p_only_deleted and t.deleted_at is not null)
         or (not p_only_deleted and t.deleted_at is null))
    and (p_from is null or t.entry_date >= p_from)
    and (p_to is null or t.entry_date <= p_to)
    and (p_entry_type is null or t.entry_type = p_entry_type)
    and (p_property_type is null or t.property_type = p_property_type)
    and (p_commission_mode is null or t.commission_mode = p_commission_mode)
    and (
      p_search is null or btrim(p_search) = ''
      or lower(t.description) like '%' || lower(btrim(p_search)) || '%'
      or lower(coalesce(t.reference, '')) like '%' || lower(btrim(p_search)) || '%'
    )
    and (
      p_broker_id is null
      or exists (
        select 1 from public.entry_broker_splits s
        where s.entry_id = t.entry_id and s.broker_id = p_broker_id and s.deleted_at is null
      )
    )
  order by t.entry_date desc, t.created_at desc;
$$;

-- Resumo agregado do período/filtros -----------------------------------------
create or replace function public.report_summary(
  p_from            date default null,
  p_to              date default null,
  p_entry_type      public.entry_type default null,
  p_broker_id       uuid default null,
  p_property_type   public.property_type default null,
  p_commission_mode public.amount_mode default null,
  p_search          text default null
)
returns table (
  total_gross_commission        numeric,
  total_broker_payout           numeric,
  total_net_revenue             numeric,
  entries_count                 integer,
  sales_count                   integer,
  rental_count                  integer,
  sales_base_amount             numeric,
  sales_gross_commission        numeric,
  sales_net_revenue             numeric,
  rental_base_amount            numeric,
  rental_gross_commission       numeric,
  rental_net_revenue            numeric,
  average_gross_commission      numeric,
  net_margin                    numeric,
  weighted_sale_commission_rate numeric,
  average_broker_payout_rate    numeric
)
language sql
stable
as $$
  select
    public.fin_money(coalesce(sum(e.gross_commission), 0)),
    public.fin_money(coalesce(sum(e.total_broker_payout), 0)),
    public.fin_money(coalesce(sum(e.net_company_revenue), 0)),
    count(*)::integer,
    count(*) filter (where e.entry_type = 'sale')::integer,
    count(*) filter (where e.entry_type = 'rental')::integer,
    public.fin_money(coalesce(sum(e.base_amount) filter (where e.entry_type = 'sale'), 0)),
    public.fin_money(coalesce(sum(e.gross_commission) filter (where e.entry_type = 'sale'), 0)),
    public.fin_money(coalesce(sum(e.net_company_revenue) filter (where e.entry_type = 'sale'), 0)),
    public.fin_money(coalesce(sum(e.base_amount) filter (where e.entry_type = 'rental'), 0)),
    public.fin_money(coalesce(sum(e.gross_commission) filter (where e.entry_type = 'rental'), 0)),
    public.fin_money(coalesce(sum(e.net_company_revenue) filter (where e.entry_type = 'rental'), 0)),
    public.fin_money(sum(e.gross_commission) / nullif(count(*), 0)),
    public.fin_net_margin(sum(e.net_company_revenue), sum(e.gross_commission)),
    round(
      sum(e.gross_commission) filter (where e.entry_type = 'sale')
        / nullif(sum(e.base_amount) filter (where e.entry_type = 'sale'), 0) * 100, 4
    ),
    round(sum(e.total_broker_payout) / nullif(sum(e.gross_commission), 0) * 100, 4)
  from public.report_entries(
    p_from, p_to, p_entry_type, p_broker_id, p_property_type, p_commission_mode, p_search, false
  ) e;
$$;

-- Série mensal com meses sem movimento zerados --------------------------------
create or replace function public.report_monthly_series(
  p_from            date,
  p_to              date,
  p_entry_type      public.entry_type default null,
  p_broker_id       uuid default null,
  p_property_type   public.property_type default null,
  p_commission_mode public.amount_mode default null,
  p_search          text default null
)
returns table (
  year                    integer,
  month                   integer,
  period_key              text,
  total_gross_commission  numeric,
  total_broker_payout     numeric,
  total_net_revenue       numeric,
  sales_gross_commission  numeric,
  rental_gross_commission numeric,
  sales_base_amount       numeric,
  rental_base_amount      numeric,
  entries_count           integer,
  sales_count             integer,
  rental_count            integer
)
language sql
stable
as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month_start
  ),
  entries as (
    select * from public.report_entries(
      p_from, p_to, p_entry_type, p_broker_id, p_property_type, p_commission_mode, p_search, false
    )
  )
  select
    extract(year from m.month_start)::integer,
    extract(month from m.month_start)::integer,
    to_char(m.month_start, 'YYYY-MM'),
    public.fin_money(coalesce(sum(e.gross_commission), 0)),
    public.fin_money(coalesce(sum(e.total_broker_payout), 0)),
    public.fin_money(coalesce(sum(e.net_company_revenue), 0)),
    public.fin_money(coalesce(sum(e.gross_commission) filter (where e.entry_type = 'sale'), 0)),
    public.fin_money(coalesce(sum(e.gross_commission) filter (where e.entry_type = 'rental'), 0)),
    public.fin_money(coalesce(sum(e.base_amount) filter (where e.entry_type = 'sale'), 0)),
    public.fin_money(coalesce(sum(e.base_amount) filter (where e.entry_type = 'rental'), 0)),
    count(e.entry_id)::integer,
    count(e.entry_id) filter (where e.entry_type = 'sale')::integer,
    count(e.entry_id) filter (where e.entry_type = 'rental')::integer
  from months m
  left join entries e
    on date_trunc('month', e.entry_date) = m.month_start
  group by m.month_start
  order by m.month_start;
$$;

-- Ranking de corretores no período -------------------------------------------
create or replace function public.report_broker_ranking(
  p_from            date default null,
  p_to              date default null,
  p_entry_type      public.entry_type default null,
  p_broker_id       uuid default null,
  p_property_type   public.property_type default null,
  p_commission_mode public.amount_mode default null,
  p_search          text default null
)
returns table (
  broker_id                     uuid,
  broker_name                   text,
  broker_is_active              boolean,
  participations                integer,
  total_payout                  numeric,
  average_payout                numeric,
  participated_base_amount      numeric,
  participated_gross_commission numeric,
  last_participation            date
)
language sql
stable
as $$
  with entries as (
    select * from public.report_entries(
      p_from, p_to, p_entry_type, p_broker_id, p_property_type, p_commission_mode, p_search, false
    )
  )
  select
    s.broker_id,
    coalesce(b.full_name, '—'),
    b.is_active,
    count(*)::integer,
    public.fin_money(sum(s.payout_amount)),
    public.fin_money(sum(s.payout_amount) / nullif(count(*), 0)),
    public.fin_money(sum(e.base_amount)),
    public.fin_money(sum(e.gross_commission)),
    max(e.entry_date)
  from entries e
  join public.entry_split_amounts s on s.entry_id = e.entry_id and s.deleted_at is null
  join public.brokers b on b.id = s.broker_id
  where p_broker_id is null or s.broker_id = p_broker_id
  group by s.broker_id, b.full_name, b.is_active
  order by sum(s.payout_amount) desc;
$$;

-- Detalhe dos repasses de um corretor (relatório por corretor) ----------------
create or replace function public.report_broker_statement(
  p_broker_id uuid,
  p_from      date default null,
  p_to        date default null
)
returns table (
  entry_id           uuid,
  entry_date         date,
  entry_type         public.entry_type,
  description        text,
  reference          text,
  base_amount        numeric,
  gross_commission   numeric,
  split_mode         public.amount_mode,
  split_rate         numeric,
  split_fixed_amount numeric,
  payout_amount      numeric
)
language sql
stable
as $$
  select
    e.entry_id, e.entry_date, e.entry_type, e.description, e.reference,
    e.base_amount, e.gross_commission,
    s.split_mode, s.split_rate, s.split_fixed_amount, s.payout_amount
  from public.report_entries(p_from, p_to, null, p_broker_id, null, null, null, false) e
  join public.entry_split_amounts s
    on s.entry_id = e.entry_id and s.broker_id = p_broker_id and s.deleted_at is null
  order by e.entry_date desc;
$$;

grant execute on function
  public.report_entries(date, date, public.entry_type, uuid, public.property_type, public.amount_mode, text, boolean),
  public.report_summary(date, date, public.entry_type, uuid, public.property_type, public.amount_mode, text),
  public.report_monthly_series(date, date, public.entry_type, uuid, public.property_type, public.amount_mode, text),
  public.report_broker_ranking(date, date, public.entry_type, uuid, public.property_type, public.amount_mode, text),
  public.report_broker_statement(uuid, date, date)
to authenticated;
