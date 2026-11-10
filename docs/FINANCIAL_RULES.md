# Regras Financeiras

Estas regras são **a fonte única da verdade**. Elas existem em exatamente três lugares, que
devem sempre produzir o mesmo resultado:

1. `lib/finance/engine.ts` — TypeScript, usado no formulário (prévia) e no servidor;
2. `supabase/migrations/0003_views.sql` — funções e views SQL, usadas em consultas e agregações;
3. Relatórios e PDFs, que **consomem** (1) ou (2), nunca reimplementam.

Testes de paridade: `tests/unit/finance.spec.ts` e `docs/ACCEPTANCE_TESTS.md`.

## 1. Regime

Regime de **caixa**. Cada lançamento representa comissão efetivamente recebida.
O mês/ano financeiro derivam de `entry_date` (`Data da entrada`).

## 2. Comissão bruta

### Venda ou locação com comissão percentual

```
comissão bruta = arredondar(valor_base × percentual ÷ 100, 2)
```

### Comissão com valor fixo

```
comissão bruta = arredondar(valor_fixo, 2)
```

O valor fixo **substitui** completamente o cálculo percentual naquele lançamento.

| Tipo | Valor-base | Rótulo na interface |
| --- | --- | --- |
| `sale` | Valor da venda | "Valor da venda" |
| `rental` | Valor do primeiro aluguel | "Valor do primeiro aluguel" |

Padrões iniciais: venda **6%**, locação **100%** (apenas o primeiro aluguel).

## 3. Repasse aos corretores

Um lançamento pode ter 0, 1, 2, 3 ou N repasses. Cada repasse é percentual **ou** valor fixo:

```
repasse percentual = arredondar(comissão_bruta × percentual_corretor ÷ 100, 2)
repasse fixo       = arredondar(valor_fixo_corretor, 2)
```

Regras:

- O mesmo corretor não pode aparecer duas vezes no mesmo lançamento;
- Percentuais e valores fixos ficam gravados no lançamento (fotografia), não são lidos do
  cadastro do corretor no momento da leitura;
- Corretores inativos continuam visíveis em lançamentos antigos.

## 4. Receita líquida e margem

```
total_repasses  = soma dos repasses JÁ ARREDONDADOS individualmente
receita_líquida = arredondar(comissão_bruta − total_repasses, 2)
margem_líquida  = arredondar(receita_líquida ÷ comissão_bruta × 100, 4)
```

Se `comissão_bruta = 0`, a margem é **indefinida**: a interface exibe `—` e nunca `NaN`,
`Infinity` ou divisão por zero.

## 5. Precisão e arredondamento

- Banco: `numeric(18,2)` para dinheiro, `numeric(9,6)` para percentuais. Nunca `float`.
- Percentuais são armazenados em **pontos percentuais**: `6%` → `6.000000`; `40%` → `40.000000`.
- TypeScript: `decimal.js` com `ROUND_HALF_UP` (arredondamento comercial).
- SQL: `round(numeric, 2)`, que também arredonda meio para longe do zero.

Ordem obrigatória do cálculo:

1. Calcular comissão bruta → arredondar para 2 casas;
2. Calcular cada repasse a partir da bruta arredondada → arredondar cada um para 2 casas;
3. Somar os repasses já arredondados;
4. Receita líquida = bruta − soma → arredondar para 2 casas.

## 6. Validações bloqueantes

| Regra | Mensagem |
| --- | --- |
| Valor-base negativo | "O valor não pode ser negativo." |
| Percentual negativo ou > 100 | "Informe um percentual entre 0 e 100." |
| Venda sem valor da venda | "Informe o valor da venda." |
| Locação sem valor do primeiro aluguel | "Informe o valor do primeiro aluguel." |
| Lançamento sem data | "Informe a data da entrada." |
| Lançamento sem descrição | "Informe uma descrição." |
| Comissão percentual sem percentual | "Informe o percentual da comissão." |
| Comissão fixa sem valor | "Informe o valor fixo da comissão." |
| Repasse sem corretor | "Selecione o corretor." |
| Repasse percentual sem percentual | "Informe o percentual do repasse." |
| Repasse fixo sem valor | "Informe o valor do repasse." |
| Corretor duplicado | "Este corretor já foi adicionado ao lançamento." |
| Mais de 2 casas decimais em dinheiro | "Use no máximo duas casas decimais." |

## 7. Exceção financeira (receita líquida negativa)

Se `total_repasses > comissão_bruta`, o salvamento é **bloqueado por padrão** com o alerta:

> A soma dos repasses aos corretores é maior que a comissão bruta. Isso fará com que a receita
> líquida da imobiliária fique negativa.

Para salvar mesmo assim, o administrador precisa:

1. Marcar `Confirmar exceção financeira`;
2. Escrever uma justificativa com **no mínimo 10 caracteres**;
3. Confirmar novamente no diálogo.

A exceção é registrada integralmente na auditoria (`exception_confirmed`, `exception_reason`).
A regra é aplicada no cliente, no servidor (Zod) **e no banco** (função `app_save_entry`).

## 8. Padrões não retroativos

Alterar um padrão em `organization_settings` **nunca** altera lançamentos existentes:
cada lançamento guarda `commission_mode`, `commission_rate` e `commission_fixed_amount`
próprios, e cada repasse guarda `split_mode`, `split_rate` e `split_fixed_amount` próprios.
Os padrões apenas pré-preenchem **novos** formulários.

## 9. Agregações

Todas derivam das mesmas views/funções (ver `DATABASE_SCHEMA.md`):

```
comissão bruta de vendas       soma de gross_commission onde entry_type = 'sale'
comissão bruta de locações     soma de gross_commission onde entry_type = 'rental'
ticket médio                   total_gross_commission ÷ entries_count
margem líquida média           total_net_revenue ÷ total_gross_commission × 100
% médio ponderado de venda     sales_gross_commission ÷ sales_base_amount × 100
% médio de repasses            total_broker_payout ÷ total_gross_commission × 100
```

Comparações com período anterior: quando o período anterior não tem base (zero),
a interface exibe "Sem período anterior para comparação" — nunca crescimento infinito.

## 10. Ranking de corretores

Por corretor, dentro do período filtrado:

- `participations` — número de lançamentos em que participou;
- `total_payout` — soma dos repasses recebidos;
- `average_payout` — média por participação;
- `participated_base_amount` — soma do valor-base das operações em que participou
  (**volume das operações em que participou**, não receita própria);
- `last_participation` — data da última participação.

A interface deixa explícito que volume e comissão bruta referem-se a **operações em que o
corretor participou** e não são receita individual dele.

---

## Controle Financeiro (`/financeiro`, migração 0010)

### Livro-razão gerencial

Cada fato financeiro gera um **lote** (`fin_ledger_batches`) de **partidas** (`fin_postings`) com
valor assinado (+ débito, − crédito). Um trigger diferido garante soma zero por lote; outro torna as
partidas imutáveis. Estorno = lote espelho na data original (`reverses_batch_id`).

Baldes: `cash` (por conta), `receivable`, `payable`, `revenue`, `expense`, `third_party`, `deposit`,
`equity`, `opening`.

| Fato | Partidas |
|---|---|
| Reconhecimento de entrada (competência) | Dr a receber / Cr balde da natureza |
| Reconhecimento de saída (competência) | Dr balde da natureza / Cr a pagar |
| Baixa de entrada | Dr caixa(conta) / Cr a receber |
| Baixa de saída | Dr a pagar / Cr caixa(conta) |
| Transferência | Dr caixa(destino) / Cr caixa(origem) — sem efeito no resultado |
| Ajuste de saldo | caixa ± contra `opening` — justificativa obrigatória (10+) |
| Saldo inicial da conta | caixa contra `opening` |

Previsões (`is_forecast`) e cancelados **não** geram partidas.

### Naturezas das categorias

| Natureza | Direção | Entra no resultado? |
|---|---|---|
| `own_revenue` receita própria | entrada | sim (+) |
| `other_revenue` outras receitas | entrada | sim (+) |
| `deduction` deduções/impostos | saída | sim (−) |
| `direct_cost` custos diretos | saída | sim (−) |
| `operating_expense` despesas operacionais | saída | sim (−) |
| `other_expense` outras despesas | saída | sim (−) |
| `third_party` valores de terceiros | ambas | **não** — obrigação |
| `deposit` cauções | ambas | **não** — obrigação |
| `equity` sócios/aportes/retiradas | ambas | **não** |

### Regimes

- **Competência**: valor do título na `competence_date`.
- **Caixa**: baixas ativas pela `settled_on`.

Ambos vêm de `fin_pl_items`; o sinal vem de `fin_result_sign`.

### Operações imobiliárias

- **Aluguel recebido** (`app_fin_register_rental_collection`): entrada bruta no caixa; taxa de
  administração → receita própria; diferença → obrigação de repasse ao proprietário (a pagar).
  Ex.: 10.000 com taxa 1.000 → caixa +10.000; receita 1.000; a repassar 9.000.
- **Comissão no caixa** (`app_fin_register_commission_receipt`): a partir de um lançamento de
  comissão; bruta no caixa, receita líquida da imobiliária como receita própria, repasses aos
  corretores como obrigações. Duplicidade bloqueada (índice único por `commission_entry_id`).
  Ex.: venda 500.000 a 6% com 40% ao corretor → caixa +30.000; receita 18.000; repasses 12.000.

### Indicadores

- **Saldo em contas** = soma do balde `cash`.
- **Disponível da imobiliária** = saldo em contas − obrigações com terceiros − cauções.
- **Previsão 30 dias** = saldo + a receber − a pagar com vencimento até hoje + 30 (inclui previsões).

### Parcelamento

1 a 60 parcelas; valor = total ÷ n arredondado; o resto vai para a última (1.000 em 3 →
333,33 / 333,33 / 333,34).

### Conciliação bancária (Fase 2, migração 0011)

- **Importar não move dinheiro.** As transações do extrato ficam em `fin_statement_lines` como
  `pending` até serem conciliadas ou ignoradas.
- **Idempotência**: `unique (account_id, external_id)`. OFX usa o FITID (`ofx:<FITID>`); sem FITID
  único ou CSV, usamos uma impressão digital de data|valor|descrição|documento + a ordem entre
  linhas idênticas do mesmo arquivo. Reimportar o mesmo período não duplica.
- **Conciliar** = ligar a linha a **um** movimento de caixa da mesma conta com o **mesmo valor
  assinado**: baixa (entrada +, saída −), transferência (sai −, entra +) ou ajuste. O saldo inicial
  não é transação bancária. Um movimento concilia com no máximo uma linha (índices únicos).
- **Sugestão inequívoca**: mesmo valor, até 3 dias de diferença, um único candidato de cada lado.
  Só é aplicada quando o usuário clica em "Confirmar".
- **Resolver uma linha**: (1) conciliar com movimento existente; (2) baixar uma conta em aberto com
  a data/valor do banco (baixa parcial permitida); (3) criar lançamento já realizado ou
  transferência; (4) ignorar com justificativa (10+).
- **Integridade**: estornar a baixa, cancelar o lançamento ou alterar valor/conta de transferência
  devolve a linha para `pending` automaticamente (triggers).
- **Diferença** = saldo final do extrato − saldo do sistema na mesma data.

### Regras e recorrências

- Regras (`fin_rules`): texto (contém/começa/igual, sem acento e sem caixa), direção, conta, faixa de
  valor → categoria, favorecido, centro de custo. Menor `priority` vence. São **sugestões**: no
  extrato só criam lançamentos após revisão e confirmação; no formulário sugerem a categoria antes
  do histórico.
- Recorrências (`fin_recurrences`): mensal, trimestral ou anual, sempre calculadas a partir da data
  inicial (sem deriva de fim de mês). Geram **previsões** (`is_forecast`, sem partidas) até 90 dias.
  Editar cancela as previsões futuras intocadas e refaz; ocorrências já pagas ou confirmadas não se
  repetem.

### DRE gerencial (Fase 3, migração 0012)

Fonte: `fin_report_dre(de, até, regime)` — soma por categoria e mês, com sinal de efeito no caixa
(+ entrada, − saída), a partir de `fin_pl_items` (a mesma base do resumo). A montagem em
`lib/finance/dre.ts` só soma:

```
Receita operacional bruta            (own_revenue)
(−) Deduções e impostos               (deduction)
= Receita operacional líquida
(−) Custos diretos                    (direct_cost)
= Resultado bruto
(−) Despesas operacionais             (operating_expense)
= Resultado operacional
(+) Outras receitas                   (other_revenue)
(−) Outras despesas                   (other_expense)
= Resultado líquido                   == fin_report_summary.net_result
Margem líquida = resultado líquido ÷ receita bruta (— sem receita)
```

Fora do resultado, em memória: valores de terceiros, cauções e movimentos de sócios.

### Fluxo de caixa projetado

`fin_cash_projection(dias, dia|semana|mês, incluir_previsões)`: saldo de hoje + títulos em aberto
(a receber +, a pagar −, inclui repasses e, se marcado, previsões) pela data de vencimento. A
primeira linha reúne os **vencidos**. O saldo final em 30 dias por dia é igual a
`forecast_30_balance` do painel (testado).

### Fechamento mensal

- Só fecha mês já terminado; perfis `gestor`, `financeiro`, `admin`.
- Bloqueio em um único ponto: trigger antes de inserir em `fin_ledger_batches`. Como todo efeito
  no razão gera lote (lançar, editar valor/categoria/data, baixar, estornar, cancelar), nada com
  data no mês fechado passa. Erro `CF001`.
- O fechamento guarda um retrato (`snapshot`): resumo nos dois regimes, checklist e saldos.
- Reabrir: só `admin`, justificativa de 10+ caracteres, auditado. O histórico de fechamentos fica.
- Previsões e conciliação (que não geram lote) continuam possíveis num mês fechado.

### Central de inteligência

`fin_insights()` — alertas determinísticos, cada um com a regra exibida na tela: disponível próprio
negativo, caixa projetado negativo, repasses a terceiros vencidos, contas vencidas, previsões
passadas, extrato pendente > 7 dias, comissões fora do caixa, mês anterior sem fechamento,
tendência do resultado, despesa > 130% da média de 3 meses. Nenhum alerta executa ação.

### Controle Financeiro simplificado (migração 0013)

- **Navegação**: a tela inicial mostra o ano em 12 cartões (`fin_report_year_cards`). Cada mês abre
  `/financeiro/mes/AAAA-MM` com Resumo, Saídas, Entradas, Extrato do banco e Resultado/fechamento.
- **Lançamento rápido** (`app_fin_quick_entry`): entrada ou saída, já paga ou não, e "repete todo mês"
  com **valor fixo** (salário) ou **valor variável** (luz, água).
  - A ocorrência do mês informado é uma conta real (a pagar/receber ou paga); as próximas são
    previsões (sem efeito no razão).
  - Variável: a estimativa das próximas é o último valor pago (`fin_recurrence_estimate`); ao pagar com
    outro valor (`app_fin_pay_occurrence`), as previsões futuras intocadas passam a usar esse valor.
- **Comissão recebida** (Vendas/Locações): a bolinha "Recebido" pede a data (digitada) e a conta e
  chama `app_fin_register_commission_receipt` — caixa +bruta, receita própria = líquida, repasses aos
  corretores como obrigações. A linha fica verde. Desmarcar = `app_fin_cancel_operation` (estorna).
  Depois de recebida, alterar valores ou excluir a comissão é bloqueado (gatilho diferido que compara
  os totais com a operação).
- **Importação de documentos escaneados**: `scripts/finance-import.mjs` → `fin_admin_preview_import`
  / `fin_admin_import_entries` (só `service_role`). Executa `app_fin_quick_entry` em nome do usuário
  (auditoria normal), lote inteiro ou nada, com `fin_admin_cancel_import_batch` para desfazer.
