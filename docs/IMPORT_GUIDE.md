# Guia de Importação da Planilha

Traz o histórico de `CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx` para a base única, **recalculando tudo**.

## O que foi encontrado na planilha real

Análise do arquivo original (16 abas):

| Aba | Papel | Importada? |
| --- | --- | --- |
| `⚙ Config` | Parâmetros e cadastro de corretores | Não |
| `📊 Geral` | Consolidação anual com fórmulas entre abas | Não |
| `📈 Dashboard` | Espelho da aba Geral | Não |
| `Jan` … `Dez` | Lançamentos mensais | **Sim** |
| `🖨 Relatório` | Impressão com `INDEX/MATCH` | Não |

Estrutura das abas mensais: cabeçalho na **linha 8**, dados nas linhas 9–108.

```
Nº | Imóvel / Endereço | Tipo | Corretor | Valor da Venda | % Comissão Venda |
Comissão Total | % Corretor | % Imob | Repasse Corretor | Receita Imob
```

### Problemas reais que o importador resolve

| Problema encontrado | Exemplo na planilha | Tratamento |
| --- | --- | --- |
| Percentual como fração | `Jan!G9 = 0.05` | Converte para `5%` e **sinaliza na prévia** |
| Percentual como texto | `Jan!G10 = "5%"` | Converte para `5` |
| Percentual em pontos | `Fev!G10 = 6` | Mantém `6` |
| Repasse como fração | `Jan!I9 = 0.5` | Converte para `50%` |
| Nome com espaço sobrando | `"Marcos Fábio "` | Normaliza e agrupa com `"Marcos Fábio"` |
| Linha de totais | `Jan!B110 = "TOTAIS DO MÊS"` | Descartada (varre toda a linha, não só a descrição) |
| Linhas em branco no meio | linhas 12–108 | Ignoradas silenciosamente |
| Totais incorretos | coluna "Corretores" da aba Geral soma percentuais | **Nada** é aproveitado; tudo recalculado |
| Sem coluna de data | nenhuma aba tem data | Mês vem da aba; ano é informado na importação |

Resultado da leitura do arquivo real (ano 2026):

```
8 lançamentos · comissão bruta R$ 171.050,00 · repasses R$ 79.020,00 · líquida R$ 92.030,00
3 corretores: Marcos Fábio (5), Leonardo Farias (2), Rafaela Ferreira (1)
12 linhas de total descartadas · 4 abas ignoradas
```

A comissão bruta confere com o total anual da própria planilha (R$ 171.050), enquanto o total de
repasses da planilha estava errado — mais uma razão para recalcular.

## Como importar

1. Acesse **Importar planilha** no menu Administração.
2. Selecione o arquivo `.xlsx` (até 8 MB).
3. Informe:
   - **Ano financeiro** — a planilha só guarda o mês;
   - **Dia da entrada** — usado em todas as linhas (padrão: dia 1);
   - **Tipo de entrada** — Venda ou Locação, aplicado ao arquivo inteiro.
4. Clique em **Ler planilha e ver prévia**. Nada é gravado nesta etapa.
5. Revise a prévia:
   - totais recalculados;
   - corretores encontrados, marcados como *já cadastrado* ou *será criado*;
   - pontos de atenção (percentuais convertidos, repasse sem corretor, repasse maior que a comissão);
   - linhas descartadas e o motivo de cada uma.
6. Desmarque um corretor se quiser importar o lançamento **sem repasse**.
7. Clique em **Confirmar importação**.

## Garantias

- **Transacional**: a importação roda dentro de `app_import_entries`. Se uma linha falhar, nada é
  gravado.
- **Recalculada**: cada linha passa por `app_save_entry`, ou seja, pelas mesmas regras e validações
  do formulário manual.
- **Identificada**: todos os lançamentos recebem `import_id`, e o arquivo fica registrado em
  `entry_imports`.
- **Reversível**: **Desfazer** aplica exclusão lógica em todos os lançamentos daquela importação,
  desde que os meses envolvidos estejam abertos.
- **Auditada**: a importação e o desfazer aparecem em `/auditoria` com arquivo, ano e quantidade.
- **Sem duplicidade**: importar o mesmo arquivo duas vezes cria uma segunda importação — desfaça a
  anterior em vez de reimportar por cima.

## Se a estrutura não for reconhecida

O cabeçalho é detectado **por conteúdo**, não por posição, nas primeiras 25 linhas de cada aba. São
aceitos rótulos como:

| Coluna interna | Rótulos reconhecidos |
| --- | --- |
| Valor-base | `Valor da Venda`, `Valor do Imóvel`, `Valor Total`, `Primeiro Aluguel`, `Valor do Aluguel` |
| Descrição | `Imóvel`, `Endereço`, `Descrição`, `Cliente`, `Operação` |
| Comissão | qualquer rótulo com `%` + `comissão` |
| Repasse | qualquer rótulo com `%` + `corretor` |
| Corretor | `Corretor`, `Corretor Responsável`, `Vendedor` |
| Tipo do imóvel | rótulo começando com `Tipo` |
| Referência | `Referência`, `Contrato`, `Código` |
| Data | rótulo começando com `Data` (se existir, tem prioridade sobre o mês da aba) |

Uma aba mensal é aceita quando tem, no mínimo, **valor-base e descrição**. Se o cabeçalho não for
identificado, a aba é listada como ignorada na prévia, com o motivo — nenhum dado é inventado.

Para uma planilha muito diferente, ajuste os padrões em
`server/import/parse-spreadsheet.ts` (função `detectHeader`) e cubra o novo formato em
`tests/unit/import.spec.ts`.

## Depois de importar

1. Confira o dashboard no período importado.
2. Revise as linhas que apareceram em *pontos de atenção*.
3. Complemente o que a planilha não tinha: segundo corretor, repasses fixos, observações.
4. Feche os meses já encerrados (**Meses → mês → Fechar mês**) para congelar o histórico.
