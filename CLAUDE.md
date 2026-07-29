# CLAUDE.md — instruções permanentes do projeto

Central Financeira da **Roberta Oliveira Imóveis**: sistema interno para registrar e acompanhar
**exclusivamente as comissões recebidas pela imobiliária**.

Leia este arquivo antes de qualquer alteração. Ele vale para qualquer agente ou pessoa que trabalhe
no projeto.

## 1. Escopo

O sistema responde: quanto entrou de comissão, quanto foi para os corretores, quanto ficou para a
imobiliária, quanto veio de vendas, quanto veio de locações, como evoluiu mês a mês e quem
participou de cada operação.

Existem **dois** tipos de lançamento: `sale` (Venda) e `rental` (Locação — comissão do **primeiro
aluguel**).

## 2. Funcionalidades proibidas

Não implemente, mesmo que pareça útil e mesmo que pedido de forma vaga:

CRM, leads, pipeline, cadastro de clientes/proprietários/inquilinos, cadastro imobiliário completo,
fotos de imóveis, portais externos, contratos, assinaturas, agenda, mensagens, WhatsApp,
administração mensal de aluguel, IPTU, condomínio, inadimplência, reajustes, vistorias, recibos,
boletos, contas bancárias, Open Finance, conciliação bancária, fluxo de caixa completo, contas a
pagar/receber, folha de pagamento, contabilidade, estoque, módulos de ERP.

Ideia fora do escopo → registre em `docs/FUTURE_IDEAS.md` **sem implementar**.

## 3. Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS v4 · Radix UI ·
Supabase (PostgreSQL + Auth + RLS) · React Hook Form + Zod · Recharts · decimal.js ·
`@react-pdf/renderer` · ExcelJS · Vitest + PGlite + Playwright.

Não adicione dependência sem necessidade real. Não introduza estado global complexo.

## 4. Regras financeiras (nunca improvise)

```
comissão bruta   percentual: base × taxa ÷ 100     |  fixo: valor fixo (substitui o percentual)
repasse          percentual: bruta × taxa ÷ 100    |  fixo: valor fixo
receita líquida  bruta − soma dos repasses já arredondados
margem líquida   líquida ÷ bruta × 100  (NULL quando bruta = 0)
```

Ordem de arredondamento, obrigatória: bruta → 2 casas; cada repasse → 2 casas; somar repasses já
arredondados; líquida → 2 casas. Arredondamento comercial (`ROUND_HALF_UP`).

Padrões iniciais: venda **6%**, locação **100%**, repasse **40%**.

Detalhes em `docs/FINANCIAL_RULES.md`.

## 5. Precisão

- Dinheiro: `numeric(18,2)` no banco, `decimal.js` no TypeScript. **Nunca** `float`.
- Percentual: `numeric(9,6)` em **pontos percentuais** (`6%` → `6.000000`).
- Nunca exiba `NaN`, `Infinity` ou divisão por zero — use `—` ou "Sem base para cálculo".

## 6. Fonte única da verdade

O cálculo existe em **exatamente três lugares**, que devem concordar sempre:

1. `lib/finance/engine.ts` — TypeScript (formulário e servidor);
2. `supabase/migrations/0003_views.sql` — funções e views SQL;
3. `supabase/migrations/0007_reporting.sql` — funções de relatório que todas as telas consomem.

Regras:

- Nenhuma tela recalcula agregações por conta própria; use `server/queries/entries.ts`.
- Nenhuma regra financeira dentro de componente React.
- PDFs consomem as mesmas funções de consulta que o dashboard.
- Alterou fórmula? Atualize os três lugares **e** os testes de paridade (`tests/db/parity.spec.ts`).

## 7. Regras invioláveis do produto

- **Base única**: nunca crie tabela, arquivo ou aba por mês. Mês vem de `entry_date`.
- **Histórico imutável**: alterar padrão em `organization_settings` não altera lançamento existente.
  Cada lançamento guarda seus próprios percentuais e valores.
- **Exclusão é lógica** (`deleted_at`). A interface nunca apaga de verdade.
- **Mês fechado bloqueia** criação, edição e exclusão; reabrir exige justificativa de 10+ caracteres.
- **Repasses > comissão bruta** bloqueiam o salvamento, exceto com exceção confirmada + justificativa
  de 10+ caracteres, sempre auditada.
- **`organization_id` nunca vem do cliente** — sempre de `app_current_org()`.

## 8. Padrões de código

- TypeScript estrito, sem `any`. Nomes em inglês no código, textos de interface em **pt-BR**.
- Enums internos em inglês (`sale`, `rental`); rótulos só em `lib/formatting/labels.ts`.
- Server Components por padrão; `"use client"` apenas onde há interação.
- Cores e espaçamentos apenas via tokens do design system (`bg-surface`, `text-muted`…),
  nunca cor literal nem `var(--…)` em classe utilitária.
- Comentários explicam **decisões**, não o óbvio.
- Estrutura: `app/` rotas · `components/` UI · `features/` por domínio · `lib/` regras puras ·
  `server/` acesso a dados e relatórios · `supabase/` migrations.

## 9. Comandos

```bash
npm run dev          # desenvolvimento (porta 3010)
npm run typecheck    # obrigatório antes de concluir
npm run lint
npm run test         # unit + banco + componentes
npm run test:db      # migrations, RLS e paridade TS × SQL
npm run test:e2e     # Playwright
npm run build        # obrigatório antes de concluir
```

## 10. Critérios de conclusão

Uma tarefa só está pronta quando:

- [ ] `npm run typecheck` sem erros;
- [ ] `npm run lint` sem erros;
- [ ] `npm run test` verde (inclusive paridade TS × SQL);
- [ ] `npm run build` sem erros;
- [ ] regra financeira nova coberta por teste;
- [ ] documentação afetada atualizada;
- [ ] nenhuma tela deixada incompleta ou botão sem função.

Interface aparecendo **não** significa funcionalidade pronta.

## 11. Segurança

- RLS habilitada em todas as tabelas; views com `security_invoker = true`.
- `SUPABASE_SERVICE_ROLE_KEY` só em `lib/supabase/admin.ts` (`server-only`), nunca no cliente.
- Validação com Zod no cliente **e** no servidor; regras críticas repetidas no banco.
- Erro de banco nunca chega cru à interface — passe por `lib/errors.ts`.
- Auditoria é imutável; senhas e tokens nunca são registrados.
- Detalhes em `docs/SECURITY.md`.

## 12. Documentação obrigatória

Ao mudar comportamento, atualize o documento correspondente **na mesma tarefa**:

| Mudou | Atualize |
| --- | --- |
| Regra de cálculo | `docs/FINANCIAL_RULES.md` + testes |
| Schema, view ou RPC | `docs/DATABASE_SCHEMA.md` + `types/database.ts` |
| RLS, auth ou permissão | `docs/SECURITY.md` |
| Token, componente ou layout | `docs/DESIGN_SYSTEM.md` |
| Importador | `docs/IMPORT_GUIDE.md` |
| Instalação ou deploy | `docs/DEPLOYMENT.md` |
| Critério de aceite | `docs/ACCEPTANCE_TESTS.md` |
