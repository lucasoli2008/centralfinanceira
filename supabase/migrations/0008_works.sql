-- =============================================================================
-- Central Financeira — 0008 · Obras (controle de reformas e manutenções)
--
-- Módulo independente do financeiro de comissões: não participa do fechamento
-- de mês (assert_month_open não é anexada a nenhuma tabela aqui) e não gera
-- nenhum lançamento em financial_entries. Compartilha apenas organização,
-- autenticação, RLS e os mesmos padrões de auditoria/RPC do resto do sistema.
--
-- "Imóvel"/"proprietário" são texto livre (property_label/owner_label): o
-- projeto não tem cadastro estruturado de imóveis/proprietários (proibido em
-- CLAUDE.md) e este módulo não cria um.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contador de código por organização/ano (OBR-2026-0001)
-- -----------------------------------------------------------------------------
create table if not exists public.work_code_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year            integer not null check (year between 2000 and 2200),
  last_number     integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, year)
);

-- -----------------------------------------------------------------------------
-- Obras
-- -----------------------------------------------------------------------------
create table if not exists public.works (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  code              text not null,
  title             text not null check (length(btrim(title)) > 0),
  property_label    text not null check (length(btrim(property_label)) > 0),
  address           text not null check (length(btrim(address)) > 0),
  owner_label       text not null check (length(btrim(owner_label)) > 0),
  responsible_name  text not null check (length(btrim(responsible_name)) > 0),
  description       text not null check (length(btrim(description)) > 0),
  status            text not null default 'planejada'
                      check (status in (
                        'planejada', 'em_andamento', 'pausada', 'aguardando_material',
                        'aguardando_prestador', 'concluida', 'cancelada'
                      )),
  category          text not null default 'outros'
                      check (category in (
                        'manutencao', 'reforma', 'reparo_hidraulico', 'reparo_eletrico',
                        'pintura', 'alvenaria', 'telhado', 'limpeza', 'jardinagem',
                        'mobiliario', 'manutencao_preventiva', 'outros'
                      )),
  priority          text not null default 'normal'
                      check (priority in ('baixa', 'normal', 'alta', 'urgente')),
  requested_at      date,
  started_at        date,
  expected_at       date,
  completed_at      date,
  notes             text,
  is_archived       boolean not null default false,
  archived_at       timestamptz,
  archived_by       uuid references public.profiles (id),
  archived_reason   text,
  created_by        uuid references public.profiles (id),
  updated_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint works_dates_ck check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

-- -----------------------------------------------------------------------------
-- Lançamentos da obra: materiais, serviços e outros custos
-- -----------------------------------------------------------------------------
create table if not exists public.work_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  work_id          uuid not null references public.works (id) on delete cascade,
  entry_type       text not null check (entry_type in ('material', 'servico', 'outro_custo')),
  entry_date       date not null,
  description      text not null check (length(btrim(description)) > 0),
  category         text,
  supplier_name    text,
  quantity         numeric(14, 3) not null default 1 check (quantity > 0),
  unit             text not null default 'unidade'
                     check (unit in (
                       'unidade', 'metro', 'm2', 'm3', 'litro', 'quilo',
                       'pacote', 'caixa', 'diaria', 'servico'
                     )),
  unit_price       numeric(18, 2) not null check (unit_price >= 0),
  total_amount     numeric(18, 2) not null check (total_amount >= 0),
  total_is_manual  boolean not null default false,
  notes            text,
  created_by       uuid references public.profiles (id),
  updated_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- -----------------------------------------------------------------------------
-- Anexos: notas fiscais, comprovantes, orçamentos e fotos antes/durante/depois
-- -----------------------------------------------------------------------------
create table if not exists public.work_attachments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  work_id           uuid not null references public.works (id) on delete cascade,
  work_entry_id     uuid references public.work_entries (id) on delete set null,
  category          text not null check (category in (
                      'nota_fiscal', 'recibo', 'orcamento', 'comprovante',
                      'foto_antes', 'foto_durante', 'foto_depois', 'outro_documento'
                    )),
  storage_path      text not null unique,
  file_name         text not null,
  mime_type         text not null check (mime_type in (
                      'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
                    )),
  file_size_bytes   integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  description       text,
  uploaded_by       uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- -----------------------------------------------------------------------------
-- Histórico legível da obra (não é o audit_logs genérico: aqui o texto já vem
-- pronto para exibição, gravado explicitamente por cada RPC de escrita).
-- -----------------------------------------------------------------------------
create table if not exists public.work_activities (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  work_id           uuid not null references public.works (id) on delete cascade,
  action            text not null check (action in (
                      'obra_criada', 'status_alterado', 'item_adicionado', 'item_removido',
                      'documento_enviado', 'foto_adicionada', 'obra_concluida', 'obra_arquivada'
                    )),
  description       text not null,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
create unique index if not exists works_org_code_uidx
  on public.works (organization_id, code);

create index if not exists works_search_trgm_idx
  on public.works using gin (
    (title || ' ' || property_label || ' ' || address || ' ' || owner_label) gin_trgm_ops
  )
  where is_archived = false;

create index if not exists works_org_status_idx
  on public.works (organization_id, status)
  where is_archived = false;

create index if not exists works_org_updated_idx
  on public.works (organization_id, updated_at desc)
  where is_archived = false;

create index if not exists work_entries_work_idx
  on public.work_entries (work_id)
  where deleted_at is null;

create index if not exists work_entries_org_type_idx
  on public.work_entries (organization_id, entry_type)
  where deleted_at is null;

create index if not exists work_entries_supplier_trgm_idx
  on public.work_entries using gin (supplier_name gin_trgm_ops)
  where deleted_at is null;

create index if not exists work_attachments_work_idx
  on public.work_attachments (work_id)
  where deleted_at is null;

create index if not exists work_attachments_entry_idx
  on public.work_attachments (work_entry_id)
  where deleted_at is null;

create index if not exists work_activities_work_idx
  on public.work_activities (work_id, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at automático e auditoria genérica (mesmos triggers de 0001/0004)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['works', 'work_entries']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['works', 'work_entries', 'work_attachments', 'work_activities']
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

-- Nenhuma das quatro tabelas recebe assert_month_open(): Obras é intencionalmente
-- independente do fechamento mensal de comissões.

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.work_code_counters enable row level security;
alter table public.works              enable row level security;
alter table public.work_entries       enable row level security;
alter table public.work_attachments   enable row level security;
alter table public.work_activities    enable row level security;

drop policy if exists work_code_counters_select on public.work_code_counters;
create policy work_code_counters_select on public.work_code_counters
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists work_code_counters_insert on public.work_code_counters;
create policy work_code_counters_insert on public.work_code_counters
  for insert to authenticated
  with check (public.is_active_member(organization_id));

-- Necessária para o "insert ... on conflict do update" de app_generate_work_code:
-- o Postgres exige privilégio de update na tabela mesmo quando o conflito é
-- resolvido a partir de um insert.
drop policy if exists work_code_counters_update on public.work_code_counters;
create policy work_code_counters_update on public.work_code_counters
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

drop policy if exists works_select on public.works;
create policy works_select on public.works
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists works_insert on public.works;
create policy works_insert on public.works
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists works_update on public.works;
create policy works_update on public.works
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

drop policy if exists work_entries_select on public.work_entries;
create policy work_entries_select on public.work_entries
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists work_entries_insert on public.work_entries;
create policy work_entries_insert on public.work_entries
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists work_entries_update on public.work_entries;
create policy work_entries_update on public.work_entries
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

drop policy if exists work_attachments_select on public.work_attachments;
create policy work_attachments_select on public.work_attachments
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists work_attachments_insert on public.work_attachments;
create policy work_attachments_insert on public.work_attachments
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists work_attachments_update on public.work_attachments;
create policy work_attachments_update on public.work_attachments
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

drop policy if exists work_activities_select on public.work_activities;
create policy work_activities_select on public.work_activities
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists work_activities_insert on public.work_activities;
create policy work_activities_insert on public.work_activities
  for insert to authenticated
  with check (public.is_active_member(organization_id));

grant select, insert, update on public.work_code_counters to authenticated;
grant select, insert, update on public.works, public.work_entries, public.work_attachments to authenticated;
grant select, insert on public.work_activities to authenticated;

-- -----------------------------------------------------------------------------
-- Geração segura do código da obra (OBR-2026-0001)
--
-- O upsert em work_code_counters é uma única instrução atômica: o Postgres
-- serializa concorrência na própria linha via o índice da chave primária, sem
-- precisar de "select ... for update" explícito.
-- -----------------------------------------------------------------------------
create or replace function public.app_generate_work_code(p_organization_id uuid)
returns text
language plpgsql
as $$
declare
  v_year integer := extract(year from now() at time zone 'America/Sao_Paulo')::integer;
  v_seq  integer;
begin
  insert into public.work_code_counters (organization_id, year, last_number)
  values (p_organization_id, v_year, 1)
  on conflict (organization_id, year)
  do update set last_number = public.work_code_counters.last_number + 1,
                updated_at  = now()
  returning last_number into v_seq;

  return 'OBR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Histórico legível
-- -----------------------------------------------------------------------------
create or replace function public.app_log_work_activity(
  p_work_id     uuid,
  p_action      text,
  p_description text
)
returns void
language plpgsql
as $$
declare
  v_org uuid := public.app_require_org();
begin
  insert into public.work_activities (organization_id, work_id, action, description, created_by)
  select v_org, p_work_id, p_action, p_description, public.current_profile_id()
  where exists (
    select 1 from public.works w where w.id = p_work_id and w.organization_id = v_org
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Criação/edição de obra
-- -----------------------------------------------------------------------------
create or replace function public.app_save_work(
  p_payload  jsonb,
  p_work_id  uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org        uuid := public.app_require_org();
  v_profile    uuid := public.current_profile_id();
  v_work_id    uuid := p_work_id;
  v_old_status text;
  v_new_status text := coalesce(p_payload ->> 'status', 'planejada');
  v_title      text := btrim(coalesce(p_payload ->> 'title', ''));
  v_property   text := btrim(coalesce(p_payload ->> 'property_label', ''));
  v_address    text := btrim(coalesce(p_payload ->> 'address', ''));
  v_owner      text := btrim(coalesce(p_payload ->> 'owner_label', ''));
  v_responsible text := btrim(coalesce(p_payload ->> 'responsible_name', ''));
  v_description text := btrim(coalesce(p_payload ->> 'description', ''));
  v_code       text;
begin
  perform public.set_audit_metadata(p_metadata);

  if length(v_title) = 0 then
    raise exception 'Informe o título da obra.' using errcode = 'CF002';
  end if;
  if length(v_property) = 0 then
    raise exception 'Informe o imóvel.' using errcode = 'CF002';
  end if;
  if length(v_address) = 0 then
    raise exception 'Informe o endereço.' using errcode = 'CF002';
  end if;
  if length(v_owner) = 0 then
    raise exception 'Informe o proprietário.' using errcode = 'CF002';
  end if;
  if length(v_responsible) = 0 then
    raise exception 'Informe o responsável interno.' using errcode = 'CF002';
  end if;
  if length(v_description) = 0 then
    raise exception 'Descreva a obra.' using errcode = 'CF002';
  end if;

  if v_work_id is null then
    v_code := public.app_generate_work_code(v_org);

    insert into public.works (
      organization_id, code, title, property_label, address, owner_label, responsible_name,
      description, status, category, priority, requested_at, started_at, expected_at,
      completed_at, notes, created_by, updated_by
    )
    values (
      v_org, v_code, v_title, v_property, v_address, v_owner, v_responsible, v_description,
      v_new_status,
      coalesce(p_payload ->> 'category', 'outros'),
      coalesce(p_payload ->> 'priority', 'normal'),
      nullif(p_payload ->> 'requested_at', '')::date,
      nullif(p_payload ->> 'started_at', '')::date,
      nullif(p_payload ->> 'expected_at', '')::date,
      nullif(p_payload ->> 'completed_at', '')::date,
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
      v_profile, v_profile
    )
    returning id into v_work_id;

    perform public.app_log_work_activity(v_work_id, 'obra_criada', 'Obra criada: ' || v_title);
  else
    select status into v_old_status
      from public.works
     where id = v_work_id and organization_id = v_org;

    if not found then
      raise exception 'Obra não encontrada.' using errcode = 'CF005';
    end if;

    update public.works
       set title             = v_title,
           property_label    = v_property,
           address           = v_address,
           owner_label       = v_owner,
           responsible_name  = v_responsible,
           description       = v_description,
           status            = v_new_status,
           category          = coalesce(p_payload ->> 'category', 'outros'),
           priority          = coalesce(p_payload ->> 'priority', 'normal'),
           requested_at      = nullif(p_payload ->> 'requested_at', '')::date,
           started_at        = nullif(p_payload ->> 'started_at', '')::date,
           expected_at       = nullif(p_payload ->> 'expected_at', '')::date,
           completed_at      = nullif(p_payload ->> 'completed_at', '')::date,
           notes             = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           updated_by        = v_profile
     where id = v_work_id and organization_id = v_org;

    if v_old_status is distinct from v_new_status then
      perform public.app_log_work_activity(
        v_work_id, 'status_alterado',
        'Status alterado de ' || v_old_status || ' para ' || v_new_status
      );
    end if;

    if v_new_status = 'concluida' and v_old_status is distinct from 'concluida' then
      perform public.app_log_work_activity(v_work_id, 'obra_concluida', 'Obra marcada como concluída.');
    end if;
  end if;

  return v_work_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Arquivar / reabrir (Obras nunca são excluídas de verdade)
-- -----------------------------------------------------------------------------
create or replace function public.app_archive_work(
  p_work_id  uuid,
  p_reason   text default null,
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
     set is_archived     = true,
         archived_at     = now(),
         archived_by     = public.current_profile_id(),
         archived_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_by      = public.current_profile_id()
   where id = p_work_id and organization_id = v_org and is_archived = false;

  if not found then
    raise exception 'Obra não encontrada ou já arquivada.' using errcode = 'CF005';
  end if;

  perform public.app_log_work_activity(p_work_id, 'obra_arquivada', 'Obra arquivada.');
end;
$$;

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
     set is_archived = false, archived_at = null, archived_by = null, archived_reason = null
   where id = p_work_id and organization_id = v_org and is_archived = true;

  if not found then
    raise exception 'Obra não encontrada na lista de arquivadas.' using errcode = 'CF005';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançamentos (materiais/serviços/outros custos)
--
-- total_amount é sempre quantity × unit_price, exceto quando o usuário ajusta
-- manualmente (total_is_manual = true), caso em que o valor enviado prevalece.
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

  if v_entry_id is null then
    insert into public.work_entries (
      organization_id, work_id, entry_type, entry_date, description, category, supplier_name,
      quantity, unit, unit_price, total_amount, total_is_manual, notes, created_by, updated_by
    )
    values (
      v_org, v_work_id, p_payload ->> 'entry_type', (p_payload ->> 'entry_date')::date,
      v_description, nullif(btrim(coalesce(p_payload ->> 'category', '')), ''),
      nullif(btrim(coalesce(p_payload ->> 'supplier_name', '')), ''),
      v_quantity, coalesce(p_payload ->> 'unit', 'unidade'), v_unit_price, v_total, v_manual,
      nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''), v_profile, v_profile
    )
    returning id into v_entry_id;

    perform public.app_log_work_activity(v_work_id, 'item_adicionado', 'Item adicionado: ' || v_description);
  else
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
           notes           = nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
           updated_by      = v_profile
     where id = v_entry_id and work_id = v_work_id and organization_id = v_org and deleted_at is null;

    if not found then
      raise exception 'Item não encontrado.' using errcode = 'CF005';
    end if;
  end if;

  return v_entry_id;
end;
$$;

create or replace function public.app_delete_work_entry(
  p_work_entry_id uuid,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
declare
  v_org     uuid := public.app_require_org();
  v_work_id uuid;
  v_desc    text;
begin
  perform public.set_audit_metadata(p_metadata);

  update public.work_entries
     set deleted_at = now(), updated_by = public.current_profile_id()
   where id = p_work_entry_id and organization_id = v_org and deleted_at is null
   returning work_id, description into v_work_id, v_desc;

  if not found then
    raise exception 'Item não encontrado.' using errcode = 'CF005';
  end if;

  perform public.app_log_work_activity(v_work_id, 'item_removido', 'Item removido: ' || v_desc);
end;
$$;

-- -----------------------------------------------------------------------------
-- Anexos — o upload físico acontece na Server Action; a RPC só registra a linha
-- depois que o arquivo já está no Storage (ou devolve o caminho para remoção
-- física, na exclusão).
-- -----------------------------------------------------------------------------
create or replace function public.app_register_work_attachment(
  p_payload  jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_org      uuid := public.app_require_org();
  v_work_id  uuid := (p_payload ->> 'work_id')::uuid;
  v_category text := p_payload ->> 'category';
  v_id       uuid;
begin
  perform public.set_audit_metadata(p_metadata);

  if not exists (select 1 from public.works w where w.id = v_work_id and w.organization_id = v_org) then
    raise exception 'Obra não encontrada.' using errcode = 'CF005';
  end if;

  insert into public.work_attachments (
    organization_id, work_id, work_entry_id, category, storage_path, file_name,
    mime_type, file_size_bytes, description, uploaded_by
  )
  values (
    v_org, v_work_id, nullif(p_payload ->> 'work_entry_id', '')::uuid, v_category,
    p_payload ->> 'storage_path', p_payload ->> 'file_name', p_payload ->> 'mime_type',
    (p_payload ->> 'file_size_bytes')::integer,
    nullif(btrim(coalesce(p_payload ->> 'description', '')), ''), public.current_profile_id()
  )
  returning id into v_id;

  perform public.app_log_work_activity(
    v_work_id,
    case when v_category like 'foto_%' then 'foto_adicionada' else 'documento_enviado' end,
    case when v_category like 'foto_%'
      then 'Foto adicionada: ' || (p_payload ->> 'file_name')
      else 'Documento enviado: ' || (p_payload ->> 'file_name')
    end
  );

  return v_id;
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
  v_org  uuid := public.app_require_org();
  v_path text;
begin
  perform public.set_audit_metadata(p_metadata);

  update public.work_attachments
     set deleted_at = now()
   where id = p_attachment_id and organization_id = v_org and deleted_at is null
   returning storage_path into v_path;

  if not found then
    raise exception 'Anexo não encontrado.' using errcode = 'CF005';
  end if;

  return v_path;
end;
$$;

grant execute on function
  public.app_generate_work_code(uuid),
  public.app_log_work_activity(uuid, text, text),
  public.app_save_work(jsonb, uuid, jsonb),
  public.app_archive_work(uuid, text, jsonb),
  public.app_unarchive_work(uuid, jsonb),
  public.app_save_work_entry(jsonb, uuid, jsonb),
  public.app_delete_work_entry(uuid, jsonb),
  public.app_register_work_attachment(jsonb, jsonb),
  public.app_delete_work_attachment(uuid, jsonb)
to authenticated;

-- -----------------------------------------------------------------------------
-- Storage — bucket privado; toda URL é assinada e gerada sob demanda (nunca
-- armazenada). Caminho: {organization_id}/{work_id}/{attachment_id}-{arquivo}.
--
-- Todo o bloco só roda quando o schema `storage` existe (projeto Supabase
-- real). Em testes de banco (PGlite, sem esse schema) é ignorado de propósito
-- — ver docs/SECURITY.md para a checagem manual obrigatória dessas policies.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'work-attachments', 'work-attachments', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      )
      on conflict (id) do nothing
    $sql$;

    execute 'drop policy if exists work_attachments_storage_select on storage.objects';
    execute $sql$
      create policy work_attachments_storage_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'work-attachments'
          and public.is_active_member((storage.foldername(name))[1]::uuid)
        )
    $sql$;

    execute 'drop policy if exists work_attachments_storage_insert on storage.objects';
    execute $sql$
      create policy work_attachments_storage_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'work-attachments'
          and public.is_active_member((storage.foldername(name))[1]::uuid)
        )
    $sql$;

    execute 'drop policy if exists work_attachments_storage_delete on storage.objects';
    execute $sql$
      create policy work_attachments_storage_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'work-attachments'
          and public.is_active_member((storage.foldername(name))[1]::uuid)
        )
    $sql$;
  end if;
end
$$;
