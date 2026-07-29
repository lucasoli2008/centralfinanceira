# Segurança

## Princípios

1. **Sem sessão, sem dado.** Nenhuma política de RLS concede acesso ao papel `anon`.
2. **A organização vem da sessão, nunca do cliente.** Toda RPC deriva o `organization_id` de
   `app_current_org()`; nenhum parâmetro de organização é aceito do navegador.
3. **Exclusão é lógica.** Nenhuma tabela financeira tem policy de `DELETE`.
4. **Auditoria é imutável.** A aplicação só lê; a escrita é feita por função `SECURITY DEFINER`.
5. **Segredos ficam no servidor.** `SUPABASE_SERVICE_ROLE_KEY` nunca é importada em código de
   cliente (`lib/supabase/admin.ts` é marcado com `server-only`).

## Autenticação

- Supabase Auth com e-mail e senha; sessão em cookies HTTP-only gerenciada por `@supabase/ssr`.
- `proxy.ts` (convenção do Next.js 16) revalida a sessão a cada navegação e redireciona para
  `/login` quem não estiver autenticado. Rotas públicas: `/login`, `/recuperar-senha`,
  `/redefinir-senha`, `/auth/callback`.
- **Não existe cadastro público.** Novos administradores são convidados pelo proprietário
  (`inviteAdministrator`), que usa a service role apenas no servidor.
- Recuperação de senha por e-mail com resposta sempre idêntica, para não revelar se um e-mail está
  cadastrado.
- Usuário desativado (`profiles.is_active = false`) ou membro inativo perde acesso imediatamente,
  porque as funções auxiliares de RLS checam os dois campos.

## Row Level Security

Habilitada em **todas** as tabelas do schema `public`. Funções auxiliares são `SECURITY DEFINER` e
`STABLE`, evitando recursão de políticas:

```sql
is_active_member(org)        -- membro ativo E perfil ativo
is_organization_owner(org)   -- idem, com role = 'owner'
app_current_org()            -- organização da sessão
shares_organization(user)    -- para leitura de perfis da mesma organização
```

Resumo das permissões:

| Tabela | Leitura | Criação | Edição | Exclusão |
| --- | --- | --- | --- | --- |
| `organizations` | membro ativo | — | proprietário | — |
| `profiles` | próprio + mesma org | trigger | próprio | — |
| `organization_members` | membro ativo | proprietário | proprietário | — |
| `brokers` | membro ativo | membro ativo | membro ativo | — |
| `financial_entries` | membro ativo | membro ativo | membro ativo | — (lógica) |
| `entry_broker_splits` | membro ativo | membro ativo | membro ativo | — (lógica) |
| `organization_settings` | membro ativo | proprietário | proprietário | — |
| `monthly_closings` | membro ativo | membro ativo | membro ativo | — |
| `entry_imports` | membro ativo | membro ativo | membro ativo | — |
| `audit_logs` | membro ativo | — (definer) | — | — |

Privilégios de tabela são concedidos explicitamente (`grant`) e revogados de `anon`.
Views usam `security_invoker = true`; sem isso, uma view rodaria com os privilégios do dono e
contornaria a RLS.

## Validação em camadas

A mesma regra é aplicada três vezes, de propósito:

| Camada | Onde | O que garante |
| --- | --- | --- |
| Cliente | `lib/validation/entry.ts` via React Hook Form | Feedback imediato |
| Servidor | Server Actions revalidando com Zod | Ninguém burla o formulário |
| Banco | Constraints, triggers e RPCs | Nem um `INSERT` direto passa |

Regras que existem obrigatoriamente no banco: mês fechado, repasse acima da comissão bruta,
justificativa mínima de 10 caracteres, corretor duplicado, corretor de outra organização.

## Auditoria

`audit_logs` registra criação, edição, exclusão lógica, restauração, fechamento e reabertura de mês,
alteração de configurações, cadastro/inativação de corretor e administrador, importações e exceções
financeiras confirmadas.

Cada registro guarda `before_data`/`after_data` completos e `metadata` com justificativa, IP e
user agent (truncado em 180 caracteres). **Senhas e tokens nunca são registrados.**

Logs técnicos (`logServerError`) são separados dos logs de auditoria e não chegam à interface.

## Tratamento de erros

`lib/errors.ts` traduz códigos do PostgreSQL e da aplicação para mensagens humanas. Mensagens de
erro internas do banco nunca são exibidas; o usuário vê algo específico e acionável, e o detalhe
técnico vai para o log do servidor.

## Arquivos e uploads

O logotipo é referenciado por URL HTTPS validada por Zod (`organizationSchema`), não por upload
direto — evita processar binários e não depende de arquivos locais em produção.
A planilha importada é lida em memória, com limite de **8 MB** e extensão restrita a `.xlsx`/`.xlsm`;
nada é gravado em disco.

## Exclusão física

A interface **não** exclui lançamentos definitivamente. Se for necessário (LGPD, erro grave), o
procedimento é administrativo, fora da aplicação:

```sql
-- 1. Reabrir o mês, se estiver fechado
select public.app_reopen_month(2026, 7, 'Exclusão definitiva autorizada por escrito');

-- 2. Desabilitar temporariamente a imutabilidade da auditoria (apenas superusuário)
alter table public.audit_logs disable trigger audit_logs_immutable;

-- 3. Remover o registro e sua trilha
delete from public.entry_broker_splits where entry_id = '<uuid>';
delete from public.financial_entries where id = '<uuid>';

-- 4. Reabilitar a proteção
alter table public.audit_logs enable trigger audit_logs_immutable;
```

Registre por escrito quem autorizou, quando e por quê.

## Checklist de dependências

```bash
npm audit
npm outdated
```

Vulnerabilidades conhecidas hoje estão restritas a dependências de **desenvolvimento**
(cadeia do ESLint e do PostCSS); nenhuma afeta o runtime de produção.
