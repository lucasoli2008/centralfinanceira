# Assistente de IA

Painel de chat (ícone de estrela na barra superior) que responde perguntas em linguagem natural
sobre os dados financeiros da organização e monta links para os relatórios em PDF já existentes.
Disponível para qualquer membro ativo — mesmo nível de acesso do Dashboard e de Relatórios.

## Regra de ouro: a IA nunca calcula nada sozinha

O assistente **não tem acesso direto ao banco** e **não soma, arredonda nem estima** nenhum valor
financeiro. Toda resposta numérica vem literalmente do resultado de uma ferramenta, e cada
ferramenta é só uma porta de entrada para uma função que já existe em `server/queries/entries.ts`
ou `server/queries/brokers.ts` — as mesmas funções que alimentam o Dashboard, as listas e os PDFs
(ver `CLAUDE.md` §6, "Fonte única da verdade").

O único cálculo feito fora do banco é o "ticket médio" de `ranking_corretores`
(`participated_base_amount ÷ participations`), e mesmo esse usa `safeRatio()` de
`lib/finance/engine.ts` — a mesma função de divisão segura usada no resto do sistema — em vez de
pedir para o modelo dividir.

## Arquitetura

| Arquivo | Papel |
| --- | --- |
| `lib/ai/tools.ts` | Define as 8 ferramentas (JSON Schema + validação Zod) e despacha cada uma para a função real |
| `lib/ai/broker-match.ts` | Lógica pura de casamento de nome de corretor (reaproveita `brokerNameKey` da importação) |
| `lib/ai/assistant.ts` | Prompt de sistema e laço manual de tool-use (function calling) com a API da OpenAI (`gpt-4o-mini`) |
| `app/api/assistente/route.ts` | Route Handler autenticado (`requireAppContext`); sem estado — o cliente reenvia o histórico completo a cada pergunta |
| `components/assistant/assistant-panel.tsx` | Painel de chat, sem persistência (fechar o diálogo esquece a conversa) |

## Ferramentas disponíveis

`resolver_periodo`, `resolver_corretor`, `resumo_financeiro`, `ranking_corretores`,
`serie_mensal`, `extrato_corretor`, `listar_lancamentos`, `gerar_relatorio`. Todas somente
leitura; nenhuma grava nada.

## Provedor de IA

API da OpenAI (`openai` no `package.json`), modelo `gpt-4o-mini` — constante `MODEL` no topo de
`lib/ai/assistant.ts`, único lugar a trocar para atualizar o modelo (o projeto atual da OpenAI só
libera esse modelo; troque para `gpt-5`/`gpt-5.1` quando o acesso for liberado — confirme com
`client.models.list()` antes de trocar, pois a listagem pode não refletir a permissão real de uso).
Exige `OPENAI_API_KEY` no ambiente do servidor (ver `docs/DEPLOYMENT.md`). As ferramentas são
declaradas no formato de
*function calling* da OpenAI (`type: "function"`), definidas em `lib/ai/tools.ts` a partir de um
JSON Schema por ferramenta — a lógica de despacho (`dispatchTool`) é a mesma independentemente do
provedor.

## Adicionando uma ferramenta nova

1. A ferramenta **tem que** apontar para uma função de `server/queries/entries.ts` ou
   `server/queries/brokers.ts` (ou uma nova função lá, se a agregação ainda não existir). Nunca
   faça `select`/soma direta dentro de `lib/ai/tools.ts`.
2. Se a agregação em si ainda não existe, ela precisa nascer em `supabase/migrations/0007_reporting.sql`
   primeiro (fonte única da verdade), não só em TypeScript.
3. Adicione a definição JSON Schema em `TOOLS` e o schema Zod correspondente em `TOOL_SCHEMAS`
   (mesmo arquivo) — a validação Zod impede que uma entrada mal formada do modelo chegue à
   consulta.
4. Documente no prompt de sistema (`buildSystemPrompt` em `lib/ai/assistant.ts`) qualquer
   ambiguidade de nomenclatura, do jeito que já existe para "ticket médio" vs. "repasse médio".

## Limites deliberados

- Sem histórico persistido — nenhuma tabela nova, nenhum "estado global complexo" (proibido pelo
  `CLAUDE.md` §3).
- Laço de tool-use limitado a 6 idas e vindas por pergunta.
- `gerar_relatorio` nunca renderiza PDF — só monta a URL de uma das quatro rotas que já existem em
  `app/api/relatorios/*`, reaproveitando 100% de `server/reports/pdf.tsx` e
  `server/reports/branding.ts`.
