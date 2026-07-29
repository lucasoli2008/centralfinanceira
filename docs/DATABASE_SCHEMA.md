# Modelo de Dados

Banco: **PostgreSQL (Supabase)**. Migrations em `supabase/migrations/`, aplicadas em ordem
alfabética. Todas as tabelas financeiras têm `organization_id`, mesmo existindo hoje uma única
imobiliária.

## Convenções

| Tipo de dado | Coluna | Motivo |
| --- | --- | --- |
| Dinheiro | `numeric(18,2)` | Nunca `float`/`double precision` |
| Percentual | `numeric(9,6)` | Armazenado em pontos percentuais (`6%` → `6.000000`) |
| Data da entrada | `date` | Sem hora: define mês e ano financeiros |
| Datas de sistema | `timestamptz` | `created_at`, `updated_at`, `deleted_at` |
| Dados de auditoria | `jsonb` | `before_data`, `after_data`, `metadata` |

## Enums

```
entry_type      sale | rental
property_type   residential | commercial
amount_mode     percentage | fixed
member_role     owner | admin
member_status   active | inactive
closing_status  open | closed
```

## Tabelas

### `organizations`
Identidade e personalização: `name`, `legal_name`, `document_number`, `logo_url`, `accent_color`
(validado como `#RRGGBB`), `timezone` (`America/Sao_Paulo`), `currency` (`BRL`), `locale` (`pt-BR`).

### `profiles`
1:1 com `auth.users` (criada automaticamente pelo trigger `on_auth_user_created`).
`is_active = false` remove o acesso do usuário em todas as políticas de RLS.

### `organization_members`
Vincula perfil e organização com `role` (`owner`/`admin`) e `status`. Único por
`(organization_id, user_id)`. Só `owner` gerencia membros e configurações.

### `brokers`
Corretores **não têm login** — são registros de cálculo.
`default_split_mode`, `default_split_rate`, `default_split_fixed_amount` apenas pré-preenchem novos
repasses. `is_active` controla a exibição na seleção de novos lançamentos, sem afetar o histórico.

### `financial_entries` — base única
Não existe tabela por mês. Colunas de entrada: `entry_type`, `entry_date`, `description`,
`reference`, `property_type`, `base_amount`, `commission_mode`, `commission_rate`,
`commission_fixed_amount`, `notes`.

Colunas geradas: `entry_year`, `entry_month` (`generated always as … stored`), usadas em índices e
agrupamentos.

Constraints relevantes:

```sql
-- coerência entre modo e valor informado
(commission_mode = 'percentage' and commission_rate is not null)
  or (commission_mode = 'fixed' and commission_fixed_amount is not null)

-- exceção financeira exige justificativa de 10+ caracteres
exception_confirmed = false
  or (exception_reason is not null and length(btrim(exception_reason)) >= 10)
```

Exclusão é sempre lógica: `deleted_at`, `deleted_by`, `deletion_reason`.

### `entry_broker_splits`
Um lançamento tem N repasses. Índice único parcial garante que o mesmo corretor não apareça duas
vezes no mesmo lançamento:

```sql
create unique index entry_broker_splits_unique_broker_idx
  on entry_broker_splits (entry_id, broker_id) where deleted_at is null;
```

### `organization_settings`
Uma linha por organização com os padrões de comissão de venda e locação, percentual padrão de
repasse, `monthly_closing_enabled`, `report_header` e `report_footer`.
**Alterar estes valores nunca altera lançamentos existentes.**

### `monthly_closings`
Único por `(organization_id, year, month)`. Guarda quem fechou, quando, quem reabriu e a
justificativa da reabertura.

### `audit_logs`
Somente leitura para a aplicação. Escrita exclusivamente por `write_audit_log()`
(`SECURITY DEFINER`) e pelo trigger `audit_row_change`. O trigger `audit_logs_immutable` bloqueia
`UPDATE`/`DELETE`.

### `entry_imports`
Um registro por importação de planilha, com `source_filename`, `entries_count`, `metadata` e
`undone_at` — permite desfazer a importação inteira.

## Motor financeiro em SQL (`0003_views.sql`)

Funções imutáveis, espelhando `lib/finance/engine.ts`:

```
fin_money(numeric)                              -> round(valor, 2)
fin_gross_commission(mode, base, rate, fixed)   -> comissão bruta
fin_split_amount(mode, gross, rate, fixed)      -> repasse individual
fin_net_margin(net, gross)                      -> margem ou NULL
```

Views, todas com `security_invoker = true` para que a RLS **não** seja contornada:

| View | Conteúdo |
| --- | --- |
| `entry_split_amounts` | Repasses com valor calculado e dados do corretor |
| `financial_entry_totals` | Um registro por lançamento com bruta, repasses, líquida, margem, nº de corretores, `period_key` |
| `monthly_financial_summary` | Agregação mensal completa (vendas, locações, contagens, médias, taxas) |

## Funções de consulta (`0007_reporting.sql`)

Dashboard, tabelas, visão mensal e PDFs consomem **exclusivamente** estas funções — é o que garante
que os totais batem em toda parte:

```
report_entries(from, to, entry_type, broker, property_type, commission_mode, search, only_deleted)
report_summary(...)              -> uma linha com todos os agregados
report_monthly_series(from, to, ...) -> série mensal com meses vazios zerados
report_broker_ranking(...)       -> ranking por corretor no período
report_broker_statement(broker, from, to) -> extrato de um corretor
```

## Operações transacionais (`0006_rpc.sql`)

A organização **nunca** vem do cliente: é derivada de `app_current_org()`.

```
app_save_entry(payload, entry_id, metadata)   -> cria/edita lançamento + repasses
app_delete_entry(id, reason, metadata)        -> exclusão lógica
app_restore_entry(id, metadata)               -> restauração
app_close_month(year, month, metadata)
app_reopen_month(year, month, reason, metadata)
app_save_broker(payload, broker_id, metadata)
app_import_entries(payload, metadata)         -> importação transacional
app_undo_import(import_id, metadata)
```

Códigos de erro da aplicação:

| Código | Significado |
| --- | --- |
| `CF001` | Mês financeiro fechado |
| `CF002` | Repasses acima da comissão bruta sem exceção confirmada |
| `CF003` | Duplicidade (corretor no lançamento, nome de corretor) |
| `CF004` | Operação não permitida |
| `CF005` | Registro inexistente ou de outra organização |

## Triggers

| Trigger | Efeito |
| --- | --- |
| `*_touch_updated_at` | Mantém `updated_at` |
| `*_audit` | Grava auditoria de create/update/delete/restore |
| `audit_logs_immutable` | Impede alterar ou apagar auditoria |
| `financial_entries_month_guard` | Bloqueia alterações em mês fechado |
| `entry_broker_splits_month_guard` | Idem, via lançamento |
| `on_auth_user_created` | Cria `profiles` para novos usuários |

## Índices

Cobrem os filtros reais da aplicação (ver `0002_indexes.sql`):

```
financial_entries (organization_id, entry_date desc) where deleted_at is null
financial_entries (organization_id, entry_type, entry_date desc) where deleted_at is null
financial_entries (organization_id, entry_year, entry_month) where deleted_at is null
financial_entries (organization_id, created_at desc)
financial_entries GIN trigram em lower(description) e lower(reference)
entry_broker_splits (entry_id, broker_id) where deleted_at is null
entry_broker_splits (organization_id, broker_id) where deleted_at is null
monthly_closings (organization_id, year, month)
audit_logs (organization_id, created_at desc) · (entity_type, entity_id) · (user_id)
```

## Testes do schema

`tests/db/` sobe um PostgreSQL real em memória (PGlite), aplica todas as migrations e verifica
schema, RLS, auditoria, fechamento mensal e a **paridade de centavos entre TypeScript e SQL**:

```bash
npm run test:db
```
