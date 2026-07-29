-- =============================================================================
-- Central Financeira — Remoção completa dos dados de demonstração
--
-- Execute ANTES de colocar o sistema em produção, caso o seed tenha sido
-- aplicado no mesmo projeto Supabase.
--
--   psql "$DATABASE_URL" -f supabase/seed_cleanup.sql
-- =============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- Meses fechados bloqueiam alterações: reabrir antes de remover.
  update public.monthly_closings set status = 'open' where organization_id = v_org;

  -- A auditoria é imutável para a aplicação; a limpeza do seed é um
  -- procedimento administrativo executado com privilégios de banco.
  alter table public.audit_logs disable trigger audit_logs_immutable;

  delete from public.entry_broker_splits where organization_id = v_org;
  delete from public.financial_entries where organization_id = v_org;
  delete from public.entry_imports where organization_id = v_org;
  delete from public.brokers where organization_id = v_org;
  delete from public.monthly_closings where organization_id = v_org;
  delete from public.organization_settings where organization_id = v_org;
  delete from public.organization_members where organization_id = v_org;
  delete from public.audit_logs where organization_id = v_org;
  delete from public.organizations where id = v_org;

  alter table public.audit_logs enable trigger audit_logs_immutable;

  raise notice 'Dados de demonstração removidos.';
end
$$;
