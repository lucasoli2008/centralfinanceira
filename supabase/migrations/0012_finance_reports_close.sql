-- =============================================================================
-- 0012 — Controle Financeiro, Fase 3: DRE gerencial, fluxo de caixa projetado,
-- fechamento mensal e central de inteligência.
--
-- * Fechamento: um mês fechado bloqueia QUALQUER efeito no livro-razão com data
--   nesse mês (lançar, editar valor/categoria/data, baixar, estornar, cancelar).
--   O bloqueio fica num único ponto: antes de inserir um lote em
--   fin_ledger_batches. Reabrir exige perfil administrador e justificativa.
-- * DRE e projeção são funções SQL — as telas e os relatórios só exibem.
-- * Inteligência: alertas determinísticos e explicáveis, calculados dos dados
--   reais. Nenhum alerta executa ação.
-- =============================================================================

-- Valor em reais no padrão brasileiro, independente do locale do servidor.
create or replace function public.fin_brl(p_value numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || translate(to_char(coalesce(p_value, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- -----------------------------------------------------------------------------
-- 1. Fechamento mensal
-- -----------------------------------------------------------------------------
create table if not exists public.fin_period_closes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year            integer not null check (year between 2000 and 2100),
  month           integer not null check (month between 1 and 12),
  closed_at       timestamptz not null default now(),
  closed_by       uuid references public.profiles (id),
  notes           text,
  snapshot        jsonb not null default '{}'::jsonb,
  reopened_at     timestamptz,
  reopened_by     uuid references public.profiles (id),
  reopen_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fin_period_closes_reopen_ck check (
    (reopened_at is null and reopen_reason is null) or (reopened_at is not null and length(btrim(reopen_reason)) >= 10)
  )
);
create unique index if not exists fin_period_closes_active_uidx
  on public.fin_period_closes (organization_id, year, month) where reopened_at is null;

drop trigger if exists fin_period_closes_touch_updated_at on public.fin_period_closes;
create trigger fin_period_closes_touch_updated_at before update on public.fin_period_closes
  for each row execute function public.touch_updated_at();
drop trigger if exists fin_period_closes_audit on public.fin_period_closes;
create trigger fin_period_closes_audit after insert or update or delete on public.fin_period_closes
  for each row execute function public.audit_row_change();

alter table public.fin_period_closes enable row level security;
drop policy if exists fin_period_closes_select on public.fin_period_closes;
create policy fin_period_closes_select on public.fin_period_closes for select to authenticated
  using (public.fin_can(organization_id, 'view'));
drop policy if exists fin_period_closes_insert on public.fin_period_closes;
create policy fin_period_closes_insert on public.fin_period_closes for insert to authenticated
  with check (public.fin_can(organization_id, 'close') and public.fin_rpc_context());
drop policy if exists fin_period_closes_update on public.fin_period_closes;
create policy fin_period_closes_update on public.fin_period_closes for update to authenticated
  using (public.fin_can(organization_id, 'close'))
  with check (public.fin_can(organization_id, 'close') and public.fin_rpc_context());
grant select, insert, update on public.fin_period_closes to authenticated;
revoke all on public.fin_period_closes from anon;

create or replace function public.fin_is_period_closed(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fin_period_closes
    where organization_id = p_org
      and year = extract(year from p_date)::integer
      and month = extract(month from p_date)::integer
      and reopened_at is null
  );
$$;

-- Ponto único de bloqueio: todo efeito no razão passa por um lote.
create or replace function public.fin_block_closed_period()
returns trigger
language plpgsql
as $$
begin
  if public.fin_is_period_closed(new.organization_id, new.posting_date) then
    raise exception 'O mês de % está fechado no Controle Financeiro. Reabra o mês para alterar lançamentos com data nele.',
      to_char(new.posting_date, 'MM/YYYY')
      using errcode = 'CF001';
  end if;
  return new;
end;
$$;

drop trigger if exists fin_ledger_batches_closed_period on public.fin_ledger_batches;
create trigger fin_ledger_batches_closed_period
  before insert on public.fin_ledger_batches
  for each row execute function public.fin_block_closed_period();

-- Itens a revisar antes de fechar o mês. Avisos não impedem o fechamento.
create or replace function public.fin_close_checklist(p_year integer, p_month integer)
returns table (check_key text, label text, severity text, quantity integer, amount numeric, href text)
language sql
stable
as $$
  with org as (select public.app_current_org() as id),
  bounds as (
    select make_date(p_year, p_month, 1) as d_from,
           (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as d_to
  )
  select 'statement_pending', 'Linhas de extrato do mês ainda não conciliadas', 'warning',
         count(*)::integer, coalesce(sum(abs(l.amount)), 0), '/financeiro/conciliacao'
  from public.fin_statement_lines l, org, bounds
  where l.organization_id = org.id and l.status = 'pending' and l.posted_on between bounds.d_from and bounds.d_to
  union all
  select 'forecast_past', 'Previsões com data no mês que não foram confirmadas nem baixadas', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-pagar?status=forecast'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.status = 'forecast' and d.reference_date between bounds.d_from and bounds.d_to
  union all
  select 'payables_overdue', 'Contas a pagar vencidas no mês ainda em aberto', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-pagar?status=overdue'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.kind = 'expense' and d.status in ('open', 'partial')
    and d.reference_date between bounds.d_from and bounds.d_to and d.reference_date < public.fin_today()
  union all
  select 'receivables_overdue', 'Contas a receber vencidas no mês ainda em aberto', 'warning',
         count(*)::integer, coalesce(sum(d.remaining_amount), 0), '/financeiro/a-receber?status=overdue'
  from public.fin_entries_detail d, org, bounds
  where d.organization_id = org.id and d.kind = 'income' and d.status in ('open', 'partial')
    and d.reference_date between bounds.d_from and bounds.d_to and d.reference_date < public.fin_today()
  union all
  select 'commissions_out', 'Comissões do mês registradas que não entraram no caixa', 'info',
         count(*)::integer, coalesce(sum(t.gross_commission), 0), '/financeiro/imobiliario'
  from public.financial_entry_totals t, org, bounds
  where t.organization_id = org.id and t.deleted_at is null and t.gross_commission > 0
    and t.entry_date between bounds.d_from and bounds.d_to
    and not exists (select 1 from public.fin_operations o where o.commission_entry_id = t.entry_id and o.cancelled_at is null);
$$;

create or replace function public.app_fin_close_period(
  p_year     integer,
  p_month    integer,
  p_notes    text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.fin_require('close');
  v_from    date := make_date(p_year, p_month, 1);
  v_to      date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_id      uuid;
  v_caixa   jsonb;
  v_comp    jsonb;
begin
  perform public.set_audit_metadata(p_metadata);
  if v_to >= public.fin_today() then
    raise exception 'Só é possível fechar um mês depois que ele termina.' using errcode = 'CF002';
  end if;
  if public.fin_is_period_closed(v_org, v_from) then
    raise exception 'Este mês já está fechado.' using errcode = 'CF003';
  end if;

  select to_jsonb(s) into v_caixa from public.fin_report_summary(v_from, v_to, 'caixa') s;
  select to_jsonb(s) into v_comp from public.fin_report_summary(v_from, v_to, 'competencia') s;

  insert into public.fin_period_closes (organization_id, year, month, closed_by, notes, snapshot)
  values (
    v_org, p_year, p_month, public.current_profile_id(), nullif(btrim(coalesce(p_notes, '')), ''),
    jsonb_build_object(
      'caixa', v_caixa,
      'competencia', v_comp,
      'checklist', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.fin_close_checklist(p_year, p_month) c),
      'balances', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.fin_account_balances(v_to) b)
    )
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_fin_reopen_period(
  p_year     integer,
  p_month    integer,
  p_reason   text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.fin_require('admin');
begin
  perform public.set_audit_metadata(coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('justificativa', p_reason));
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo da reabertura com pelo menos 10 caracteres.' using errcode = 'CF002';
  end if;
  update public.fin_period_closes
     set reopened_at = now(), reopened_by = public.current_profile_id(), reopen_reason = btrim(p_reason)
   where organization_id = v_org and year = p_year and month = p_month and reopened_at is null;
  if not found then
    raise exception 'Este mês não está fechado.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. DRE gerencial — valores por categoria e mês, com sinal de efeito no caixa
--    (+ entrada, − saída). As linhas e subtotais são montados a partir disto.
-- -----------------------------------------------------------------------------
create or replace function public.fin_report_dre(p_from date, p_to date, p_regime text default 'competencia')
returns table (
  nature        text,
  group_id      uuid,
  group_name    text,
  group_order   integer,
  category_id   uuid,
  category_name text,
  period_key    text,
  amount        numeric
)
language sql
stable
as $$
  select i.nature,
         g.id, g.name, g.sort_order,
         c.id, c.name,
         to_char(i.item_date, 'YYYY-MM'),
         sum(case when i.kind = 'income' then i.amount else -i.amount end)
  from public.fin_pl_items(p_from, p_to, coalesce(p_regime, 'competencia')) i
  join public.fin_categories c on c.id = i.category_id
  left join public.fin_categories g on g.id = coalesce(c.parent_id, c.id)
  group by i.nature, g.id, g.name, g.sort_order, c.id, c.name, to_char(i.item_date, 'YYYY-MM')
  order by g.sort_order, g.name, c.name, 7;
$$;

-- -----------------------------------------------------------------------------
-- 3. Fluxo de caixa projetado
--    Saldo de hoje + títulos em aberto (inclui previsões) pela data de
--    vencimento. A primeira linha (bucket_start nulo) reúne os VENCIDOS.
-- -----------------------------------------------------------------------------
create or replace function public.fin_cash_projection(
  p_days              integer default 90,
  p_bucket            text default 'week',
  p_include_forecasts boolean default true
)
returns table (
  bucket_start    date,
  bucket_end      date,
  inflow          numeric,
  outflow         numeric,
  third_party_out numeric,
  forecast_in     numeric,
  forecast_out    numeric,
  opening_balance numeric,
  closing_balance numeric
)
language sql
stable
as $$
  with params as (
    select public.fin_today() as today,
           (public.fin_today() + greatest(1, least(coalesce(p_days, 90), 730)))::date as horizon,
           case when p_bucket in ('day', 'week', 'month') then p_bucket else 'week' end as bucket
  ),
  opening as (
    select coalesce(sum(p.amount), 0) as balance
    from public.fin_postings p, params
    where p.organization_id = public.app_current_org() and p.bucket = 'cash' and p.posting_date <= params.today
  ),
  items as (
    select d.kind, d.nature, d.status, d.remaining_amount as amount,
           d.reference_date < params.today as overdue,
           case params.bucket
             when 'day'   then d.reference_date
             when 'month' then date_trunc('month', d.reference_date)::date
             else (params.today + ((d.reference_date - params.today) / 7) * 7)
           end as b_start
    from public.fin_entries_detail d, params
    where d.organization_id = public.app_current_org()
      and d.kind in ('income', 'expense')
      and d.status in ('open', 'partial', 'forecast')
      and (p_include_forecasts or d.status <> 'forecast')
      and d.reference_date <= params.horizon
      and d.remaining_amount > 0
  ),
  series as (
    select gs::date as b_start
    from params,
         generate_series(
           case params.bucket when 'month' then date_trunc('month', params.today)::date else params.today end,
           params.horizon,
           case params.bucket when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '7 days' end
         ) gs
  ),
  buckets as (
    select null::date as b_start, null::date as b_end, 0 as ord
    union all
    select s.b_start,
           least(
             case (select bucket from params)
               when 'day' then s.b_start
               when 'month' then (s.b_start + interval '1 month - 1 day')::date
               else s.b_start + 6
             end,
             (select horizon from params)
           ),
           1
    from series s
  ),
  totals as (
    select b.b_start, b.b_end, b.ord,
      coalesce(sum(i.amount) filter (where i.kind = 'income'), 0) as inflow,
      coalesce(sum(i.amount) filter (where i.kind = 'expense'), 0) as outflow,
      coalesce(sum(i.amount) filter (where i.kind = 'expense' and i.nature = 'third_party'), 0) as third_party_out,
      coalesce(sum(i.amount) filter (where i.kind = 'income' and i.status = 'forecast'), 0) as forecast_in,
      coalesce(sum(i.amount) filter (where i.kind = 'expense' and i.status = 'forecast'), 0) as forecast_out
    from buckets b
    left join items i
      on (b.ord = 0 and i.overdue)
      or (b.ord = 1 and not i.overdue and i.b_start = b.b_start)
    group by b.b_start, b.b_end, b.ord
  )
  select t.b_start, t.b_end, t.inflow, t.outflow, t.third_party_out, t.forecast_in, t.forecast_out,
         opening.balance + coalesce(sum(t.inflow - t.outflow) over (order by t.ord, t.b_start
           rows between unbounded preceding and 1 preceding), 0),
         opening.balance + sum(t.inflow - t.outflow) over (order by t.ord, t.b_start rows between unbounded preceding and current row)
  from totals t, opening
  order by t.ord, t.b_start;
$$;

-- -----------------------------------------------------------------------------
-- 4. Central de inteligência — alertas explicáveis a partir dos dados reais
-- -----------------------------------------------------------------------------
create or replace function public.fin_insights()
returns table (
  insight_key text,
  severity    text,      -- critical | warning | info | positive
  title       text,
  detail      text,
  metric      numeric,
  href        text
)
language plpgsql
stable
as $$
declare
  v_org          uuid := public.app_current_org();
  v_today        date := public.fin_today();
  v_month_start  date := date_trunc('month', public.fin_today())::date;
  v_last_from    date := (date_trunc('month', public.fin_today()) - interval '1 month')::date;
  v_last_to      date := (date_trunc('month', public.fin_today()) - interval '1 day')::date;
  v_prev_from    date := (date_trunc('month', public.fin_today()) - interval '2 months')::date;
  v_prev_to      date := (date_trunc('month', public.fin_today()) - interval '1 month' - interval '1 day')::date;
  v_sum          record;
  v_last         record;
  v_prev         record;
  v_neg          record;
  v_count        integer;
  v_amount       numeric;
  v_row          record;
begin
  if v_org is null or not public.fin_can(v_org, 'view') then
    return;
  end if;

  select * into v_sum from public.fin_report_summary(v_month_start, v_today, 'caixa');

  -- Dinheiro de terceiros financiando a operação
  if v_sum.own_available < 0 then
    insight_key := 'own_available_negative'; severity := 'critical';
    title := 'O caixa está usando dinheiro de proprietários e corretores';
    detail := 'O saldo em contas é menor que o total devido a terceiros e cauções. Faltam '
      || public.fin_brl(-v_sum.own_available) || ' para cobrir os repasses.';
    metric := v_sum.own_available; href := '/financeiro';
    return next;
  end if;

  -- Caixa projetado negativo nos próximos 90 dias
  select * into v_neg from public.fin_cash_projection(90, 'week') p
  where p.closing_balance < 0 order by p.bucket_start nulls first limit 1;
  if found then
    insight_key := 'projection_negative'; severity := 'critical';
    title := case when v_neg.bucket_start is null
      then 'Os títulos vencidos já deixam o caixa negativo'
      else 'O caixa projetado fica negativo na semana de ' || to_char(v_neg.bucket_start, 'DD/MM') end;
    detail := 'Saldo projetado: ' || public.fin_brl(v_neg.closing_balance)
      || '. Considera contas a pagar e a receber em aberto e as previsões.';
    metric := v_neg.closing_balance; href := '/financeiro/fluxo';
    return next;
  end if;

  -- Repasses atrasados a proprietários/corretores
  select count(*)::integer, coalesce(sum(d.remaining_amount), 0) into v_count, v_amount
  from public.fin_entries_detail d
  where d.organization_id = v_org and d.kind = 'expense' and d.nature = 'third_party'
    and d.status in ('open', 'partial') and d.is_overdue;
  if v_count > 0 then
    insight_key := 'third_party_overdue'; severity := 'critical';
    title := v_count || ' repasse(s) a terceiros em atraso';
    detail := 'Total de ' || public.fin_brl(v_amount) || ' que pertence a proprietários ou corretores e já venceu.';
    metric := v_amount; href := '/financeiro/a-pagar?status=overdue&natureza=third_party';
    return next;
  end if;

  if v_sum.payables_overdue > 0 then
    insight_key := 'payables_overdue'; severity := 'warning';
    title := 'Contas a pagar vencidas';
    detail := public.fin_brl(v_sum.payables_overdue) || ' em despesas da imobiliária passaram do vencimento.';
    metric := v_sum.payables_overdue; href := '/financeiro/a-pagar?status=overdue';
    return next;
  end if;

  if v_sum.receivables_overdue > 0 then
    insight_key := 'receivables_overdue'; severity := 'warning';
    title := 'Recebimentos em atraso';
    detail := public.fin_brl(v_sum.receivables_overdue) || ' a receber com vencimento passado.';
    metric := v_sum.receivables_overdue; href := '/financeiro/a-receber?status=overdue';
    return next;
  end if;

  -- Previsões vencidas sem confirmação
  select count(*)::integer, coalesce(sum(d.remaining_amount), 0) into v_count, v_amount
  from public.fin_entries_detail d
  where d.organization_id = v_org and d.status = 'forecast' and d.reference_date < v_today;
  if v_count > 0 then
    insight_key := 'forecast_past'; severity := 'warning';
    title := v_count || ' previsão(ões) com data passada';
    detail := 'Confirme, baixe ou cancele para que o fluxo projetado reflita a realidade ('
      || public.fin_brl(v_amount) || ').';
    metric := v_amount; href := '/financeiro/a-pagar?status=forecast';
    return next;
  end if;

  -- Extrato pendente há mais de 7 dias
  select count(*)::integer, coalesce(sum(abs(l.amount)), 0) into v_count, v_amount
  from public.fin_statement_lines l
  where l.organization_id = v_org and l.status = 'pending' and l.posted_on < v_today - 7;
  if v_count > 0 then
    insight_key := 'statement_stale'; severity := 'warning';
    title := v_count || ' transação(ões) do banco sem conciliação há mais de 7 dias';
    detail := 'Movimentos que estão no extrato e ainda não foram identificados no sistema.';
    metric := v_amount; href := '/financeiro/conciliacao';
    return next;
  end if;

  -- Comissões fora do caixa (desde sempre)
  select count(*)::integer, coalesce(sum(t.gross_commission), 0) into v_count, v_amount
  from public.financial_entry_totals t
  where t.organization_id = v_org and t.deleted_at is null and t.gross_commission > 0
    and not exists (select 1 from public.fin_operations o where o.commission_entry_id = t.entry_id and o.cancelled_at is null);
  if v_count > 0 then
    insight_key := 'commissions_out'; severity := 'info';
    title := v_count || ' comissão(ões) registrada(s) sem entrada no caixa';
    detail := 'Somam ' || public.fin_brl(v_amount) || ' em comissão bruta. Lance quando o dinheiro entrar.';
    metric := v_amount; href := '/financeiro/imobiliario';
    return next;
  end if;

  -- Mês anterior sem fechamento (com movimento)
  if exists (select 1 from public.fin_ledger_batches b where b.organization_id = v_org and b.posting_date between v_last_from and v_last_to)
     and not public.fin_is_period_closed(v_org, v_last_from) then
    insight_key := 'last_month_open'; severity := 'info';
    title := 'O mês de ' || to_char(v_last_from, 'MM/YYYY') || ' ainda não foi fechado';
    detail := 'Fechar o mês trava os números já conferidos e guarda um retrato do resultado.';
    metric := null; href := '/financeiro/fechamento';
    return next;
  end if;

  -- Resultado do último mês fechado x anterior (competência)
  select * into v_last from public.fin_report_summary(v_last_from, v_last_to, 'competencia');
  select * into v_prev from public.fin_report_summary(v_prev_from, v_prev_to, 'competencia');
  if v_last.own_revenue > 0 or v_prev.own_revenue > 0 then
    if v_prev.net_result <> 0 then
      insight_key := 'result_trend';
      severity := case when v_last.net_result >= v_prev.net_result then 'positive' else 'warning' end;
      title := 'Resultado de ' || to_char(v_last_from, 'MM/YYYY') || ': '
        || public.fin_brl(v_last.net_result)
        || case when v_last.net_result >= v_prev.net_result then ' (acima' else ' (abaixo' end
        || ' do mês anterior)';
      detail := 'Mês anterior: ' || public.fin_brl(v_prev.net_result)
        || '. Variação de ' || replace(to_char(round((v_last.net_result - v_prev.net_result) / abs(v_prev.net_result) * 100, 1), 'FM9999990.0'), '.', ',') || '%.';
      metric := v_last.net_result - v_prev.net_result; href := '/financeiro/dre';
      return next;
    end if;
  end if;

  -- Despesas que cresceram mais de 30% sobre a média dos 3 meses anteriores
  for v_row in
    with last_month as (
      select i.category_id, sum(i.amount) as total
      from public.fin_pl_items(v_last_from, v_last_to, 'competencia') i
      where i.kind = 'expense' and i.nature in ('direct_cost', 'operating_expense', 'other_expense')
      group by i.category_id
    ),
    history as (
      select i.category_id, sum(i.amount) / 3.0 as average
      from public.fin_pl_items((v_last_from - interval '3 months')::date, (v_last_from - 1), 'competencia') i
      where i.kind = 'expense'
      group by i.category_id
    )
    select c.name, l.total, h.average
    from last_month l
    join history h on h.category_id = l.category_id
    join public.fin_categories c on c.id = l.category_id
    where h.average > 0 and l.total > h.average * 1.3 and l.total - h.average >= 200
    order by l.total - h.average desc
    limit 3
  loop
    insight_key := 'expense_spike'; severity := 'warning';
    title := v_row.name || ' subiu ' || to_char(round((v_row.total / v_row.average - 1) * 100), 'FM99990') || '% em ' || to_char(v_last_from, 'MM/YYYY');
    detail := 'Gasto de ' || public.fin_brl(v_row.total) || ' contra média de '
      || public.fin_brl(v_row.average) || ' nos 3 meses anteriores.';
    metric := v_row.total - v_row.average; href := '/financeiro/dre';
    return next;
  end loop;

  return;
end;
$$;

grant execute on function
  public.fin_brl(numeric),
  public.fin_is_period_closed(uuid, date),
  public.fin_close_checklist(integer, integer),
  public.app_fin_close_period(integer, integer, text, jsonb),
  public.app_fin_reopen_period(integer, integer, text, jsonb),
  public.fin_report_dre(date, date, text),
  public.fin_cash_projection(integer, text, boolean),
  public.fin_insights()
to authenticated;
