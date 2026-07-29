# Central Financeira — Roberta Oliveira Imóveis

Sistema interno para registrar e acompanhar **as comissões recebidas pela imobiliária** —
substituindo a planilha mensal com fórmulas frágeis por uma base única, auditável e com relatórios
em PDF.

Responde, com precisão de centavos: quanto entrou de comissão, quanto foi para os corretores, quanto
ficou para a imobiliária, quanto veio de vendas, quanto veio de locações, como evoluiu mês a mês e
quanto cada corretor recebeu.

## O que o sistema faz

- **Dois tipos de lançamento**: venda de imóvel e locação (comissão do primeiro aluguel).
- **Comissão flexível**: percentual (padrão 6% na venda, 100% na locação) ou valor fixo negociado.
- **Vários corretores por lançamento**, cada um com percentual ou valor fixo próprio.
- **Regime de caixa**: o mês financeiro vem da *data da entrada* — não existe aba por mês.
- **Dashboard executivo** com filtro global de período, comparações e gráficos úteis.
- **Visão mensal** de qualquer mês, com fechamento e reabertura justificada.
- **Relatórios em PDF** gerados no servidor: mensal, anual, por corretor e filtrado.
- **Auditoria imutável** de toda ação financeira, com justificativas, IP e navegador.
- **Importação da planilha antiga**, com prévia, normalização e opção de desfazer.
- **Personalização sem código**: nome, logotipo, cor da marca, padrões de comissão, cabeçalho e
  rodapé dos relatórios.

## O que o sistema deliberadamente **não** faz

Não é CRM nem ERP: não administra imóveis, clientes, proprietários, inquilinos, contratos, agenda,
cobranças, IPTU, condomínio, inadimplência, recibos ou boletos. Ver
[`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) e [`docs/FUTURE_IDEAS.md`](docs/FUTURE_IDEAS.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript estrito · Tailwind CSS v4 · Radix UI ·
Supabase (PostgreSQL, Auth, RLS) · React Hook Form + Zod · Recharts · decimal.js ·
`@react-pdf/renderer` · ExcelJS · Vitest + PGlite + Playwright · Vercel.

## Começando

```bash
npm install
cp .env.example .env.local     # preencha com as chaves do seu projeto Supabase

# 1. aplicar as migrations
node scripts/run-migrations.mjs "postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres"
#    (ou cole supabase/migrations/*.sql no SQL Editor do Supabase, em ordem)

# 2. criar a organização e o primeiro proprietário
node scripts/bootstrap-owner.mjs "<service_role_key>" "voce@dominio.com" "<senha>"

# 3. rodar
npm run dev                    # http://localhost:3010
```

Passo a passo completo, incluindo deploy e checklist de produção:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Desenvolvimento na porta 3010 |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm run typecheck` | TypeScript estrito |
| `npm run lint` | ESLint |
| `npm run test` | Testes unitários, de banco e de componente |
| `npm run test:unit` | Motor financeiro, formatação e importador |
| `npm run test:db` | Migrations, RLS, auditoria e paridade TypeScript × SQL |
| `npm run test:e2e` | Playwright |
| `npm run db:bundle` | Gera `dist/migrations.sql` com todas as migrations |
| `npm run format` | Prettier |

## Estrutura

```
app/                 Rotas (App Router) — (auth) público, (app) autenticado, api/relatorios
components/          UI compartilhada: ui/ · layout/ · finance/ · dashboard/
features/            Domínios: auth · entries · brokers · months · reports · settings · import
lib/                 Regras puras: finance/ (motor) · validation/ · formatting/ · supabase/ · auth/
server/              Servidor: queries/ (consultas) · reports/ (PDF) · import/ (planilha)
supabase/migrations/ Schema, views, RLS, triggers e RPCs
tests/               unit/ · db/ (PGlite) · components/ · e2e/ (Playwright)
docs/                Especificação, regras financeiras, schema, segurança, design, deploy
scripts/             Migrations, bootstrap do proprietário e seed
```

## Fundamentos que não se negociam

1. **Base única de lançamentos** — o mês é uma dimensão (`entry_date`), nunca uma tabela.
2. **Fonte única da verdade** — as fórmulas existem em `lib/finance/engine.ts` e nas funções SQL;
   dashboard, tabelas, relatórios e PDFs consomem as mesmas consultas, com testes de paridade
   centavo a centavo.
3. **Histórico imutável** — mudar um padrão nunca altera lançamento já registrado.
4. **Precisão financeira** — `numeric` no banco, `decimal.js` no código, arredondamento comercial.
5. **Segurança por padrão** — RLS em todas as tabelas, exclusão apenas lógica, auditoria imutável.

Instruções permanentes para quem for editar o projeto: [`CLAUDE.md`](CLAUDE.md).

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) | Escopo, páginas e papéis |
| [`docs/FINANCIAL_RULES.md`](docs/FINANCIAL_RULES.md) | Fórmulas, arredondamento e validações |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | Tabelas, views, RPCs e índices |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Autenticação, RLS, auditoria e exclusão física |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, tipografia, componentes e acessibilidade |
| [`docs/IMPORT_GUIDE.md`](docs/IMPORT_GUIDE.md) | Importação da planilha, com o que foi achado no arquivo real |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Instalação, deploy e checklist de produção |
| [`docs/ACCEPTANCE_TESTS.md`](docs/ACCEPTANCE_TESTS.md) | Critérios de aceite e cobertura de testes |
| [`docs/FUTURE_IDEAS.md`](docs/FUTURE_IDEAS.md) | Ideias registradas e não implementadas |
