# Instalação e Deploy

## 1. Variáveis de ambiente

Copie `.env.example` para `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # só no servidor
NEXT_PUBLIC_APP_URL=http://localhost:3010      # em produção, a URL pública
```

As chaves ficam em **Project Settings → API** no painel do Supabase.
`SUPABASE_SERVICE_ROLE_KEY` é usada apenas por `lib/supabase/admin.ts` (marcado `server-only`),
para convidar administradores e no bootstrap. **Nunca** vai para o navegador nem para o Git.

## 2. Banco de dados

### Opção A — SQL Editor (mais rápido)

Cole o conteúdo de cada arquivo de `supabase/migrations/`, em ordem, em
`https://supabase.com/dashboard/project/<ref>/sql/new` e execute.

Para gerar um único arquivo com tudo:

```bash
npm run db:bundle   # gera dist/migrations.sql
```

### Opção B — Supabase CLI

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

### Opção C — conexão direta

```bash
node scripts/run-migrations.mjs "postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres"
```

## 3. Primeiro proprietário

Cria a organização, as configurações padrão e o usuário `owner`:

```bash
node scripts/bootstrap-owner.mjs "<service_role_key>" "email@dominio.com" "<senha>"
```

O script confirma o e-mail automaticamente, então já é possível entrar em `/login`.
Administradores seguintes são convidados pela própria aplicação
(**Configurações → Usuários → Convidar administrador**).

## 4. Dados de demonstração (opcional, só em desenvolvimento)

```bash
# 5 corretores + 14 meses de lançamentos na organização existente
node scripts/seed-real-org.mjs "<service_role_key>"
```

Para uma organização isolada de demonstração, use `supabase/seed.sql`; remova depois com
`supabase/seed_cleanup.sql`. **Nunca aplique seed em produção.**

## 5. Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3010
```

## 6. Qualidade

```bash
npm run typecheck    # TypeScript estrito, sem erros
npm run lint         # ESLint
npm run test         # unitários + banco (PGlite)
npm run test:unit    # apenas motor financeiro, formatação e importador
npm run test:db      # migrations, RLS, auditoria e paridade TS × SQL
npm run test:e2e     # Playwright (exige app rodando e usuário de teste)
npm run build        # build de produção
```

## 7. Deploy na Vercel

1. Importe o repositório na Vercel (framework detectado: Next.js).
2. Configure as variáveis de ambiente em **Settings → Environment Variables**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (URL final do projeto).
3. No Supabase, em **Authentication → URL Configuration**, defina:
   - **Site URL**: `https://<seu-dominio>`
   - **Redirect URLs**: `https://<seu-dominio>/auth/callback`
4. Deploy.

### PDFs em ambiente serverless

Os relatórios usam `@react-pdf/renderer`, que roda em Node puro — sem navegador headless e sem
binários extras. As rotas declaram explicitamente:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

Nenhum arquivo local é lido em produção: o logotipo vem de uma URL HTTPS.

### Fuso horário

O servidor pode estar em UTC. O sistema não depende disso:

- `entry_date` é `date` (sem hora), convertido manualmente em `lib/formatting/date.ts` para nunca
  ser interpretado como UTC;
- "hoje" é calculado com `Intl.DateTimeFormat` no fuso da organização
  (`America/Sao_Paulo`, configurável);
- `formatDateTime` recebe `timeZone` explícito.

## 8. Checklist de produção

**Banco**
- [ ] Todas as migrations aplicadas, na ordem
- [ ] `select relname, relrowsecurity from pg_class …` — RLS ativa em todas as tabelas
- [ ] Views com `security_invoker=true`
- [ ] Dados de demonstração removidos (`supabase/seed_cleanup.sql`)
- [ ] Backups automáticos habilitados no projeto Supabase

**Aplicação**
- [ ] `npm run typecheck`, `npm run lint`, `npm run test` e `npm run build` passando
- [ ] Nenhum segredo no Git (`git log -p | grep -i "service_role"` sem resultado)
- [ ] `.env.local` fora do versionamento (coberto por `.gitignore`)
- [ ] Rota de prévia de design removida (não existe mais em `app/`)

**Autenticação**
- [ ] Site URL e Redirect URLs configuradas no Supabase
- [ ] Login, recuperação e redefinição testados na URL de produção
- [ ] Proprietário criado; sem cadastro público

**Financeiro**
- [ ] Padrões conferidos em Configurações → Financeiro (venda 6%, locação 100%)
- [ ] Nome, cor e logotipo em Configurações → Empresa
- [ ] Cabeçalho e rodapé em Configurações → Relatórios
- [ ] PDF mensal, anual e por corretor abrindo corretamente
- [ ] Total do dashboard igual ao da tabela e ao do PDF no mesmo período

**Operação**
- [ ] Corretores cadastrados com o percentual padrão correto
- [ ] Histórico importado e revisado
- [ ] Meses encerrados fechados
