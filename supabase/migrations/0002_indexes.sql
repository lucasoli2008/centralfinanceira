-- =============================================================================
-- Central Financeira — 0002 · Índices
-- Cobrem os filtros usados por dashboard, listas, relatórios e auditoria.
-- =============================================================================

-- Lançamentos ----------------------------------------------------------------
create index if not exists financial_entries_org_date_idx
  on public.financial_entries (organization_id, entry_date desc)
  where deleted_at is null;

create index if not exists financial_entries_org_type_date_idx
  on public.financial_entries (organization_id, entry_type, entry_date desc)
  where deleted_at is null;

create index if not exists financial_entries_org_period_idx
  on public.financial_entries (organization_id, entry_year, entry_month)
  where deleted_at is null;

create index if not exists financial_entries_org_created_at_idx
  on public.financial_entries (organization_id, created_at desc);

create index if not exists financial_entries_deleted_at_idx
  on public.financial_entries (organization_id, deleted_at desc)
  where deleted_at is not null;

create index if not exists financial_entries_import_idx
  on public.financial_entries (import_id)
  where import_id is not null;

-- Busca textual por descrição/referência (acento-insensível via unaccent seria
-- uma dependência extra; usamos trigram sobre o texto normalizado em lower()).
create extension if not exists pg_trgm;

create index if not exists financial_entries_description_trgm_idx
  on public.financial_entries using gin (lower(description) gin_trgm_ops);

create index if not exists financial_entries_reference_trgm_idx
  on public.financial_entries using gin (lower(coalesce(reference, '')) gin_trgm_ops);

-- Repasses --------------------------------------------------------------------
create index if not exists entry_broker_splits_entry_idx
  on public.entry_broker_splits (entry_id, broker_id)
  where deleted_at is null;

create index if not exists entry_broker_splits_broker_idx
  on public.entry_broker_splits (organization_id, broker_id)
  where deleted_at is null;

-- Corretores ------------------------------------------------------------------
create index if not exists brokers_org_active_idx
  on public.brokers (organization_id, is_active, full_name);

-- Não é único: dois corretores ativos com o mesmo nome são permitidos apenas
-- com confirmação explícita (regra aplicada em app_save_broker).
create index if not exists brokers_org_normalized_name_idx
  on public.brokers (organization_id, public.normalized_name(full_name))
  where is_active;

-- Fechamentos -----------------------------------------------------------------
create index if not exists monthly_closings_org_period_idx
  on public.monthly_closings (organization_id, year, month);

-- Membros ---------------------------------------------------------------------
create index if not exists organization_members_user_idx
  on public.organization_members (user_id, status);

-- Auditoria -------------------------------------------------------------------
create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);

create index if not exists audit_logs_entity_idx
  on public.audit_logs (organization_id, entity_type, entity_id, created_at desc);

create index if not exists audit_logs_user_idx
  on public.audit_logs (organization_id, user_id, created_at desc);
