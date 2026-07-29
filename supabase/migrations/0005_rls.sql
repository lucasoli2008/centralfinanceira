-- =============================================================================
-- Central Financeira — 0005 · Row Level Security
--
-- Princípios:
--   * Sem sessão, nenhum dado é acessível (nenhuma policy para o papel anon).
--   * Um usuário só enxerga organizações das quais é membro ATIVO e cujo perfil
--     está ativo.
--   * Exclusões são sempre lógicas: nenhuma tabela financeira tem policy DELETE.
--   * Logs de auditoria são somente leitura para a aplicação.
--   * Funções auxiliares são SECURITY DEFINER para evitar recursão de policies.
-- =============================================================================

create or replace function public.is_active_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and p.is_active
  );
$$;

create or replace function public.is_organization_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
      and p.is_active
  );
$$;

-- Organização do usuário autenticado. A aplicação NUNCA envia organization_id:
-- ele é sempre derivado da sessão.
create or replace function public.app_current_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and p.is_active
  order by case when m.role = 'owner' then 0 else 1 end, m.created_at
  limit 1;
$$;

create or replace function public.shares_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = p_user_id
  );
$$;

-- Cria o perfil automaticamente para cada novo usuário do Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Habilitar RLS
-- -----------------------------------------------------------------------------
alter table public.organizations         enable row level security;
alter table public.profiles              enable row level security;
alter table public.organization_members  enable row level security;
alter table public.brokers               enable row level security;
alter table public.financial_entries     enable row level security;
alter table public.entry_broker_splits   enable row level security;
alter table public.organization_settings enable row level security;
alter table public.monthly_closings      enable row level security;
alter table public.entry_imports         enable row level security;
alter table public.audit_logs            enable row level security;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_active_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_organization_owner(id))
  with check (public.is_organization_owner(id));

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_organization(id));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_active = true);

-- -----------------------------------------------------------------------------
-- organization_members (somente o proprietário gerencia)
-- -----------------------------------------------------------------------------
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (public.is_organization_owner(organization_id));

drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));

-- -----------------------------------------------------------------------------
-- brokers
-- -----------------------------------------------------------------------------
drop policy if exists brokers_select on public.brokers;
create policy brokers_select on public.brokers
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists brokers_insert on public.brokers;
create policy brokers_insert on public.brokers
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists brokers_update on public.brokers;
create policy brokers_update on public.brokers
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- financial_entries
-- -----------------------------------------------------------------------------
drop policy if exists financial_entries_select on public.financial_entries;
create policy financial_entries_select on public.financial_entries
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists financial_entries_insert on public.financial_entries;
create policy financial_entries_insert on public.financial_entries
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists financial_entries_update on public.financial_entries;
create policy financial_entries_update on public.financial_entries
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- entry_broker_splits
-- -----------------------------------------------------------------------------
drop policy if exists entry_broker_splits_select on public.entry_broker_splits;
create policy entry_broker_splits_select on public.entry_broker_splits
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists entry_broker_splits_insert on public.entry_broker_splits;
create policy entry_broker_splits_insert on public.entry_broker_splits
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists entry_broker_splits_update on public.entry_broker_splits;
create policy entry_broker_splits_update on public.entry_broker_splits
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- organization_settings (leitura para membros, escrita para o proprietário)
-- -----------------------------------------------------------------------------
drop policy if exists organization_settings_select on public.organization_settings;
create policy organization_settings_select on public.organization_settings
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists organization_settings_insert on public.organization_settings;
create policy organization_settings_insert on public.organization_settings
  for insert to authenticated
  with check (public.is_organization_owner(organization_id));

drop policy if exists organization_settings_update on public.organization_settings;
create policy organization_settings_update on public.organization_settings
  for update to authenticated
  using (public.is_organization_owner(organization_id))
  with check (public.is_organization_owner(organization_id));

-- -----------------------------------------------------------------------------
-- monthly_closings (qualquer administrador ativo fecha e reabre)
-- -----------------------------------------------------------------------------
drop policy if exists monthly_closings_select on public.monthly_closings;
create policy monthly_closings_select on public.monthly_closings
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists monthly_closings_insert on public.monthly_closings;
create policy monthly_closings_insert on public.monthly_closings
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists monthly_closings_update on public.monthly_closings;
create policy monthly_closings_update on public.monthly_closings
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- entry_imports
-- -----------------------------------------------------------------------------
drop policy if exists entry_imports_select on public.entry_imports;
create policy entry_imports_select on public.entry_imports
  for select to authenticated
  using (public.is_active_member(organization_id));

drop policy if exists entry_imports_insert on public.entry_imports;
create policy entry_imports_insert on public.entry_imports
  for insert to authenticated
  with check (public.is_active_member(organization_id));

drop policy if exists entry_imports_update on public.entry_imports;
create policy entry_imports_update on public.entry_imports
  for update to authenticated
  using (public.is_active_member(organization_id))
  with check (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- audit_logs (somente leitura)
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.is_active_member(organization_id));

-- -----------------------------------------------------------------------------
-- Privilégios explícitos
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant select, insert, update on
  public.brokers,
  public.financial_entries,
  public.entry_broker_splits,
  public.monthly_closings,
  public.entry_imports,
  public.organization_settings,
  public.organization_members
to authenticated;

grant select, update on public.organizations, public.profiles to authenticated;
grant select on public.audit_logs to authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;

grant select on
  public.financial_entry_totals,
  public.entry_split_amounts,
  public.monthly_financial_summary
to authenticated;
