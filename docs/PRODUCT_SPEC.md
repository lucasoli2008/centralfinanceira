# Especificação do Produto — Central Financeira Roberta Oliveira Imóveis

## 1. Objetivo

Sistema interno para registrar e acompanhar **exclusivamente as comissões recebidas pela
imobiliária**, substituindo a planilha `CONTROLE_DE_VENDAS_ROBERTA_v5.xlsx`.

O sistema responde, com precisão, a estas perguntas:

- Quanto a imobiliária gerou em comissões (bruto);
- Quanto foi repassado aos corretores;
- Quanto efetivamente ficou para a imobiliária (líquido);
- Quanto veio de vendas e quanto veio de locações;
- Como os valores evoluíram mês a mês;
- Quais corretores participaram e quanto cada um recebeu;
- Quais foram os lançamentos de um mês ou período.

## 2. Escopo

### Está no escopo

| Módulo | Descrição |
| --- | --- |
| Lançamentos | Comissões de **venda** e de **locação** (primeiro aluguel), em regime de caixa |
| Corretores | Cadastro simples, sem login, com percentual padrão |
| Repasses | N corretores por lançamento, percentual ou valor fixo |
| Dashboard | Cards, comparações, gráficos, ranking, visão anual |
| Meses | Visão mensal detalhada e fechamento/reabertura de mês |
| Relatórios | PDF mensal, anual, por corretor e filtrado |
| Importação | Leitura da planilha atual com prévia, normalização e desfazer |
| Auditoria | Log imutável de toda ação financeira relevante |
| Configurações | Empresa, marca, padrões financeiros, relatórios, usuários |

### Não está no escopo (proibido implementar)

CRM, leads, pipeline, cadastro de clientes/proprietários/inquilinos, cadastro imobiliário
completo, fotos de imóveis, portais externos, contratos, assinaturas, agenda, mensagens,
WhatsApp, administração mensal de aluguel, IPTU, condomínio, inadimplência, recibos, boletos,
contas bancárias, Open Finance, conciliação bancária, fluxo de caixa completo, contas a
pagar/receber, folha de pagamento, contabilidade, estoque, módulos de ERP.

Ideias fora do escopo são registradas em [`FUTURE_IDEAS.md`](./FUTURE_IDEAS.md), nunca implementadas.

## 3. Conceitos

**Lançamento (financial entry)** — uma entrada de comissão que **efetivamente entrou no caixa**
da imobiliária. Tipos: `sale` (Venda) e `rental` (Locação).

**Data da entrada (`entry_date`)** — define mês e ano financeiros. É a única dimensão temporal
usada em dashboards, relatórios e fechamentos. Não existem tabelas ou abas por mês.

**Comissão bruta** — o que a imobiliária recebeu na operação, antes dos repasses.

**Repasse** — parte da comissão bruta destinada a um corretor participante.

**Receita líquida** — comissão bruta − soma dos repasses.

**Parcelas** — comissões recebidas em partes são lançamentos separados que compartilham a mesma
`reference`. Não existe módulo de parcelamento.

## 4. Estrutura de páginas

```
/login                          Autenticação (sem cadastro público)
/recuperar-senha                Envio do e-mail de recuperação
/redefinir-senha                Definição da nova senha
/dashboard                      Visão executiva com filtro global de período
/vendas                         Lista de vendas + filtros + resumo + PDF
/vendas/nova                    Formulário de venda
/vendas/[id]                    Detalhe (somente leitura)
/vendas/[id]/editar             Edição
/locacoes                       Lista de locações (mesma qualidade)
/locacoes/nova · /[id] · /[id]/editar
/corretores                     Lista e cadastro
/corretores/[id]                Detalhe, histórico e edição
/meses                          Visão anual dos 12 meses
/meses/[ano]/[mes]              Visão mensal detalhada + fechamento + PDF
/relatorios                     Central de relatórios em PDF
/auditoria                      Log de auditoria com filtros
/lixeira                        Registros excluídos e restauração
/importar                       Importação da planilha
/configuracoes/empresa          Nome, marca, cor, logotipo
/configuracoes/financeiro       Padrões de comissão e fechamento mensal
/configuracoes/relatorios       Cabeçalho e rodapé dos PDFs
/configuracoes/usuarios         Administradores da organização
```

## 5. Papéis

| Papel | Pode |
| --- | --- |
| `owner` | Tudo, incluindo gerenciar membros e alterar configurações da organização |
| `admin` | Lançamentos, corretores, fechamento de mês, relatórios, importação, auditoria (leitura) |

Não há papel de corretor: corretores são registros de cálculo, não usuários.

## 6. Critérios de aceite

Ver [`ACCEPTANCE_TESTS.md`](./ACCEPTANCE_TESTS.md).
