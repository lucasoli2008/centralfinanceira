-- =============================================================================
-- Central Financeira — Dados de demonstração (desenvolvimento)
--
-- Cria uma organização fictícia com 14 meses de movimento, corretores fictícios,
-- um mês sem movimento e um mês fechado. NÃO contém dados pessoais reais.
--
-- Aplicar:   psql "$DATABASE_URL" -f supabase/seed.sql
-- Remover:   psql "$DATABASE_URL" -f supabase/seed_cleanup.sql
-- =============================================================================

-- Auxiliares temporários ------------------------------------------------------
create or replace function public.seed_entry(
  p_org         uuid,
  p_type        public.entry_type,
  p_date        date,
  p_description text,
  p_reference   text,
  p_property    public.property_type,
  p_base        numeric,
  p_mode        public.amount_mode,
  p_rate        numeric,
  p_fixed       numeric
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.financial_entries (
    organization_id, entry_type, entry_date, description, reference, property_type,
    base_amount, commission_mode, commission_rate, commission_fixed_amount
  )
  values (
    p_org, p_type, p_date, p_description, p_reference, p_property,
    p_base, p_mode, p_rate, p_fixed
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.seed_split(
  p_org    uuid,
  p_entry  uuid,
  p_broker uuid,
  p_mode   public.amount_mode,
  p_rate   numeric,
  p_fixed  numeric
)
returns void
language sql
as $$
  insert into public.entry_broker_splits (
    organization_id, entry_id, broker_id, split_mode, split_rate, split_fixed_amount
  )
  values (p_org, p_entry, p_broker, p_mode, p_rate, p_fixed);
$$;

-- Dados -----------------------------------------------------------------------
do $$
declare
  v_org        uuid := '11111111-1111-1111-1111-111111111111';
  v_broker_ids uuid[];
  v_names      text[] := array[
    'Ana Martins', 'Bruno Carvalho', 'Camila Duarte', 'Diego Nogueira', 'Elisa Prado'
  ];
  v_name       text;
  v_month      date;
  v_ref_month  date := date_trunc('month', current_date)::date;
  v_entry      uuid;
  v_i          integer;
  v_seq        integer := 0;
  v_base       numeric;
  v_rate       numeric;
  v_closed     date;
begin
  -- Organização --------------------------------------------------------------
  insert into public.organizations (id, name, legal_name, accent_color, timezone, currency, locale)
  values (v_org, 'Roberta Oliveira Imóveis', 'Roberta Oliveira Gestão Imobiliária Ltda',
          '#0F5132', 'America/Sao_Paulo', 'BRL', 'pt-BR')
  on conflict (id) do nothing;

  insert into public.organization_settings (
    organization_id, default_sale_commission_rate, default_rental_commission_rate,
    default_broker_split_rate, monthly_closing_enabled, report_header, report_footer
  )
  values (
    v_org, 6, 100, 40, true,
    'Roberta Oliveira Imóveis · Central Financeira',
    'Documento gerado automaticamente · Confidencial'
  )
  on conflict (organization_id) do nothing;

  -- Corretores fictícios ------------------------------------------------------
  foreach v_name in array v_names loop
    v_seq := v_seq + 1;
    insert into public.brokers (
      organization_id, full_name, short_name, email, phone,
      default_split_mode, default_split_rate, is_active
    )
    values (
      v_org, v_name, split_part(v_name, ' ', 1),
      lower(replace(v_name, ' ', '.')) || '@exemplo.com.br',
      format('(22) 9%s000-00%s', v_seq, lpad(v_seq::text, 2, '0')),
      'percentage',
      case v_seq when 1 then 40 when 2 then 50 when 3 then 40 when 4 then 45 else 30 end,
      v_seq <> 5
    )
    on conflict do nothing;
  end loop;

  select array_agg(id order by full_name) into v_broker_ids
  from public.brokers where organization_id = v_org;

  -- 14 meses de movimento -----------------------------------------------------
  for v_i in reverse 13 .. 0 loop
    -- Um mês propositalmente sem movimento.
    continue when v_i = 4;

    v_month := (v_ref_month - (v_i || ' months')::interval)::date;
    v_base := 250000 + (v_i % 5) * 90000;
    v_rate := (array[4, 5, 5.5, 6])[1 + (v_i % 4)];

    -- Vendas ------------------------------------------------------------------
    v_entry := public.seed_entry(
      v_org, 'sale', (v_month + 6),
      format('Venda Apartamento Centro %s', to_char(v_month, 'MM/YYYY')),
      format('VD-%s-01', to_char(v_month, 'YYYYMM')),
      'residential', v_base, 'percentage', v_rate, null
    );
    perform public.seed_split(v_org, v_entry, v_broker_ids[1 + (v_i % 4)], 'percentage', 40, null);

    if v_i % 3 = 0 then
      v_entry := public.seed_entry(
        v_org, 'sale', (v_month + 17),
        format('Venda Casa Jardim Aurora %s', to_char(v_month, 'MM/YYYY')),
        format('VD-%s-02', to_char(v_month, 'YYYYMM')),
        'residential', v_base + 180000, 'percentage', 6, null
      );
      perform public.seed_split(v_org, v_entry, v_broker_ids[1], 'percentage', 40, null);
      perform public.seed_split(v_org, v_entry, v_broker_ids[2], 'percentage', 15, null);
    end if;

    if v_i % 5 = 2 then
      v_entry := public.seed_entry(
        v_org, 'sale', (v_month + 21),
        format('Venda Sala Comercial Empresarial %s', to_char(v_month, 'MM/YYYY')),
        format('VD-%s-03', to_char(v_month, 'YYYYMM')),
        'commercial', 480000, 'fixed', null, 25000
      );
      perform public.seed_split(v_org, v_entry, v_broker_ids[3], 'fixed', null, 7000);
    end if;

    -- Locações ----------------------------------------------------------------
    v_entry := public.seed_entry(
      v_org, 'rental', (v_month + 9),
      format('Locação Residencial Vila Nova %s', to_char(v_month, 'MM/YYYY')),
      format('LC-%s-01', to_char(v_month, 'YYYYMM')),
      'residential', 2400 + (v_i % 6) * 250, 'percentage', 100, null
    );
    perform public.seed_split(v_org, v_entry, v_broker_ids[2 + (v_i % 3)], 'percentage', 50, null);

    if v_i % 2 = 1 then
      v_entry := public.seed_entry(
        v_org, 'rental', (v_month + 23),
        format('Locação Comercial Avenida Central %s', to_char(v_month, 'MM/YYYY')),
        format('LC-%s-02', to_char(v_month, 'YYYYMM')),
        'commercial', 5200, 'percentage', 100, null
      );
      perform public.seed_split(v_org, v_entry, v_broker_ids[4], 'percentage', 30, null);
      perform public.seed_split(v_org, v_entry, v_broker_ids[5], 'fixed', null, 500);
    end if;
  end loop;

  -- Um mês fechado (o mais antigo com movimento) ------------------------------
  v_closed := (v_ref_month - interval '13 months')::date;
  insert into public.monthly_closings (organization_id, year, month, status, closed_at)
  values (v_org, extract(year from v_closed)::integer, extract(month from v_closed)::integer,
          'closed', now())
  on conflict (organization_id, year, month) do update set status = 'closed', closed_at = now();
end
$$;

drop function if exists public.seed_entry(uuid, public.entry_type, date, text, text, public.property_type, numeric, public.amount_mode, numeric, numeric);
drop function if exists public.seed_split(uuid, uuid, uuid, public.amount_mode, numeric, numeric);
