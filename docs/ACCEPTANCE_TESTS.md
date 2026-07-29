# Critérios de Aceite e Testes

## Estratégia

| Camada | Ferramenta | Onde | O que cobre |
| --- | --- | --- | --- |
| Unitário | Vitest | `tests/unit/` | Motor financeiro, formatação pt-BR, normalização da planilha |
| Banco | Vitest + PGlite | `tests/db/` | Migrations, RLS, auditoria, fechamento, paridade TS × SQL |
| Componente | Vitest + RTL | `tests/components/` | Entrada monetária e percentual |
| E2E | Playwright | `tests/e2e/` | Fluxos completos com navegador |

```bash
npm run test         # unit + db + componentes
npm run test:e2e     # exige app rodando e usuário de teste configurado
```

## Testes financeiros obrigatórios (§36) — `tests/unit/finance.spec.ts`

| Caso | Esperado | Status |
| --- | --- | --- |
| Venda R$ 500.000 · 6% | bruta R$ 30.000 | ✅ |
| Corretor 40% sobre R$ 30.000 | repasse R$ 12.000 · líquida R$ 18.000 | ✅ |
| Dois corretores (40% + 15%) | repasses R$ 16.500 · líquida R$ 13.500 | ✅ |
| Locação R$ 3.000 · 100% · corretor 50% | bruta R$ 3.000 · líquida R$ 1.500 | ✅ |
| Comissão decimal 5,5% sobre R$ 400.000 | bruta R$ 22.000 | ✅ |
| Repasse decimal 37,5% sobre R$ 22.000 | R$ 8.250 | ✅ |
| Comissão fixa R$ 25.000 | substitui o percentual | ✅ |
| Repasse fixo R$ 7.000 sobre R$ 25.000 | líquida R$ 18.000 | ✅ |
| Mistura percentual + fixo | soma correta com arredondamento individual | ✅ |
| Frações de centavo (33,33% × 3) | R$ 2.043,13 + R$ 2.043,13 + R$ 2.043,74 | ✅ |
| Arredondamento comercial | 2,675 → 2,68 · 1,005 → 1,01 | ✅ |
| Comissão bruta zero | margem `null`, sem `NaN`/`Infinity` | ✅ |
| Receita líquida negativa | valor negativo visível e sinalizado | ✅ |
| Alterar padrão 6% → 5% | lançamento antigo permanece 6% | ✅ |

## Paridade obrigatória — `tests/db/parity.spec.ts`

Sete cenários (incluindo valores como R$ 437.777,77 a 5,5% e três repasses de 33,3x%) são gravados
via `app_save_entry` e comparados centavo a centavo:

- `financial_entry_totals` (SQL) **=** `calculateEntryTotals` (TypeScript);
- `report_summary` **=** soma dos lançamentos calculada em TypeScript;
- `report_monthly_series` **=** `monthly_financial_summary` **=** `report_summary`;
- soma de `report_broker_ranking` **=** total de repasses do período.

Como dashboard, tabelas, visão mensal e PDFs consomem **as mesmas funções**, a igualdade
`dashboard = tabela = relatório = PDF` é estrutural, não coincidência.

## Testes de integração — `tests/db/schema.spec.ts`

| Cenário | Esperado | Status |
| --- | --- | --- |
| Migrations aplicam do zero | tabelas, views e funções criadas | ✅ |
| RLS habilitada em todas as tabelas | `relrowsecurity = true` | ✅ |
| Views com `security_invoker` | RLS não é contornada | ✅ |
| Dinheiro e percentual | sempre `numeric` | ✅ |
| Criar venda com repasse | 30.000 / 12.000 / 18.000 | ✅ |
| Dois corretores | 16.500 / 13.500 | ✅ |
| Corretor duplicado | erro `CF003` | ✅ |
| Repasses > bruta sem exceção | erro `CF002` | ✅ |
| Exceção com justificativa curta | erro `CF002` | ✅ |
| Exceção confirmada | salva, líquida negativa, auditada | ✅ |
| Editar lançamento | repasses substituídos | ✅ |
| Corretor de outra organização | erro `CF005` | ✅ |
| Alterar padrão | lançamento antigo intacto | ✅ |
| Mês fechado | insert, update e delete bloqueados (`CF001`) | ✅ |
| Reabertura sem justificativa | erro `CF002` | ✅ |
| Reabertura válida | libera alterações e registra motivo | ✅ |
| Exclusão lógica | sai dos totais, aparece na lixeira, restaura | ✅ |
| Auditoria | create → update → delete registrados com usuário | ✅ |
| Auditoria imutável | `UPDATE` bloqueado | ✅ |
| Escrita direta na auditoria | negada pela RLS | ✅ |
| Isolamento entre organizações | só a própria organização é visível | ✅ |
| Usuário com perfil inativo | nenhum dado, RPC negada | ✅ |
| Membro inativo | nenhum dado | ✅ |
| Admin alterando configurações | negado (só proprietário) | ✅ |
| Exclusão física via aplicação | negada | ✅ |
| Importar e desfazer | 2 lançamentos importados e revertidos | ✅ |

## Importação — `tests/unit/import.spec.ts`

Fixture reproduz as inconsistências reais da planilha (cabeçalho na linha 8, percentuais em quatro
formatos, nomes com espaços sobrando, linha de totais, mês sem movimento, abas não mensais).

| Cenário | Esperado | Status |
| --- | --- | --- |
| Percentuais `0.05`, `"5%"`, `6`, `1` | 5%, 5%, 6%, 100% (fração sinalizada) | ✅ |
| Dinheiro `"R$ 500.000,00"`, `"1.234,56"` | 500000, 1234.56 | ✅ |
| `"  Marcos   Fábio "` vs `"marcos fabio"` | mesma chave, sem unir nomes diferentes | ✅ |
| Abas `Config`/`Dashboard` | ignoradas | ✅ |
| Linha `TOTAIS DO MÊS` | descartada | ✅ |
| Mês sem movimento | 0 linhas, sem erro | ✅ |
| Data da entrada | mês da aba + ano informado | ✅ |
| Corretor já cadastrado | casado por nome normalizado | ✅ |
| Totais da prévia | vêm do motor financeiro | ✅ |

Verificação contra o **arquivo real** (`CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx`): 8 lançamentos,
comissão bruta R$ 171.050,00 — idêntica ao total anual da própria planilha.

## Fluxos end-to-end — `tests/e2e/`

| Fluxo | Passos | Arquivo |
| --- | --- | --- |
| 1 | Login → cadastrar corretor → registrar venda com 2 corretores → conferir resumo → salvar → dashboard → abrir mês → gerar PDF | `entries.spec.ts` |
| 2 | Registrar locação 100% com repasse 50% → conferir receita líquida | `entries.spec.ts` |
| 3 | Fechar mês → tentar editar (bloqueado) → reabrir com justificativa → editar → conferir auditoria | `closing.spec.ts` |
| 4 | Alterar comissão padrão → conferir que o histórico não mudou → novo lançamento já com o novo padrão | `settings.spec.ts` |
| 5 | Proteção de rotas: acesso sem sessão redireciona para `/login` | `auth.spec.ts` |

Pré-requisitos: `PLAYWRIGHT_EMAIL` e `PLAYWRIGHT_PASSWORD` no ambiente, apontando para um usuário
real do projeto Supabase de teste.

## Critérios absolutos de aceite (§47)

| Critério | Como é garantido |
| --- | --- |
| Entrar com segurança | Supabase Auth + `proxy.ts` protegendo todas as rotas |
| Sem cadastro público | Nenhuma rota de signup; convite só pelo proprietário |
| Cadastrar venda e locação | `/vendas/nova` e `/locacoes/nova` com terminologia própria |
| Qualquer percentual de comissão | `numeric(9,6)`, 0–100, decimais aceitos |
| Comissão fixa | `commission_mode = 'fixed'` substitui o percentual |
| Qualquer percentual de repasse e repasse fixo | `split_mode` por corretor |
| Vários corretores | Tabela `entry_broker_splits`, sem limite |
| Corretor não duplicado | Índice único parcial + validação em 3 camadas |
| Cálculos corretos | 34 testes unitários + 10 de paridade |
| Histórico imutável a mudanças de padrão | Fotografia por lançamento; teste dedicado |
| Mês pela data da entrada | `entry_year`/`entry_month` gerados de `entry_date` |
| Vendas e locações separadas | Rotas e filtros próprios |
| Consolidação no dashboard | `report_summary` sobre a base única |
| Comparar 12 meses e abrir qualquer mês | `/meses` e `/meses/[ano]/[mes]` |
| Fechamento mensal | RPCs + triggers de bloqueio |
| PDFs mensal, anual e por corretor | `/api/relatorios/*` com `@react-pdf/renderer` |
| Totais idênticos | Mesmas funções SQL em todas as telas + testes |
| Português brasileiro e moeda BRL | `Intl` com `pt-BR` em toda a formatação |
| Design consistente e responsivo | Design system com tokens; grids adaptativos |
| Auditoria funcionando | Triggers + página `/auditoria` |
| RLS habilitada | Teste que varre `pg_class` |
| Testes e build passando | `npm run test` e `npm run build` |
| Sem segredos no código | `.env*` ignorado; service role só no servidor |
| Pronto para Vercel | `docs/DEPLOYMENT.md` com checklist |
