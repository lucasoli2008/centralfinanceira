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
