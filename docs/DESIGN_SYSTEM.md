# Design System

Objetivo: densidade de ferramenta financeira profissional, com hierarquia clara e nenhum enfeite.
Referências de **postura** (não de estilo copiado): Linear, Stripe, Vercel, Notion.

## Tokens

Definidos em `app/globals.css` e expostos como utilidades do Tailwind v4 via `@theme inline`.
**Nunca** use cores literais em componentes — sempre a utilidade semântica.

| Token | Utilidade | Uso |
| --- | --- | --- |
| `--background` `#f8f8f7` | `bg-background` | Fundo da página |
| `--surface` `#ffffff` | `bg-surface` | Cards, sidebar, topbar |
| `--surface-muted` `#f4f4f3` | `bg-surface-muted` | Hover, campos desabilitados |
| `--surface-sunken` `#fbfbfa` | `bg-surface-sunken` | Cabeçalho e rodapé de tabela |
| `--border` `#e8e8e6` | `border-border` | Bordas padrão |
| `--border-strong` `#d9d9d6` | `border-border-strong` | Bordas de controle |
| `--foreground` `#1a1a19` | `text-foreground` | Texto principal |
| `--foreground-muted` `#5c5c58` | `text-muted` | Texto secundário |
| `--foreground-subtle` `#8f8f8a` | `text-subtle` | Legendas, placeholders |
| `--accent` | `bg-accent` `text-accent` | Marca — **configurável em tempo de execução** |
| `--accent-soft` / `--accent-border` | `bg-accent-soft` / `border-accent-border` | Estados ativos |
| `--positive` `--warning` `--danger` `--info` | `text-*` / `bg-*-soft` | Semântica financeira |

### Cor da marca configurável

`organizations.accent_color` é injetada como variável CSS inline em `app/(app)/layout.tsx`:

```tsx
const themeStyle = { "--accent": organization.accent_color } as CSSProperties;
```

Os tons derivados (`--accent-hover`, `--accent-soft`, `--accent-border`) usam `color-mix()`, então
mudar uma única cor no painel reconfigura toda a interface e os PDFs, sem tocar em código.
Orientação ao administrador: use um tom escuro o bastante para manter contraste com texto branco.

## Tipografia

Fonte **Geist** (`next/font`), com números tabulares em tudo que é financeiro.

| Classe | Tamanho | Uso |
| --- | --- | --- |
| `.page-title` | 21px / 600 | Título de página |
| `.section-title` | 14px / 600 | Título de card e seção |
| `.metric-value` | 26px / 600 | KPI principal |
| `.metric-value-sm` | 17px / 600 | KPI secundário, cards de mês |
| `.label-caption` | 12px / 500 muted | Rótulo de indicador |
| `.label-overline` | 11px / 600 uppercase | Cabeçalho de grupo |
| corpo | 13–14px | Texto e tabelas |
| `.tabular` | — | Alinhamento de números (aplicado a `table` por padrão) |

## Forma e elevação

- Raio: `rounded-card` (12px) para cards, `rounded-control` (8px) para controles.
- Sombras deliberadamente quase invisíveis: `shadow-card` para superfícies,
  `shadow-popover` apenas para diálogos e menus.
- Bordas de 1px fazem a separação — não sombras.
- Sem gradiente decorativo, sem glassmorphism (exceto o leve `backdrop-blur` da topbar).

## Componentes

```
components/ui/        button · field (Input, Textarea, NativeSelect, Checkbox, FormField, Callout)
                      card (Card, CardHeader, SectionHeading) · table · badge · dialog
                      menu (dropdown) · tooltip · states (skeletons, EmptyState, ErrorState)
components/layout/    sidebar (Sidebar + MobileNav) · topbar · page-header
components/finance/   money-input (MoneyInput, PercentInput) · metric-card (MetricCard, StatGroup)
                      summary-panel · period-filter
components/dashboard/ charts
```

Regra de ouro: **nenhuma regra financeira dentro de componente React.** Cálculo vem de
`lib/finance/engine.ts`; agregação vem das funções SQL.

## Arquitetura visual das telas

- **App shell**: sidebar de 236px com grupos nomeados e menu do usuário no rodapé; topbar de 52px
  com localização atual, busca de comandos (⌘K) e ação primária "Novo lançamento".
- **Dashboard**: painel herói (receita líquida) + composição → evolução mensal + receita por mês →
  3 grupos compactos de indicadores → vendas vs. locações → faixa dos 12 meses → ranking.
  A hierarquia responde primeiro "quanto sobrou", depois "de onde veio".
- **Listas**: resumo do período em cards, barra de filtros, tabela com rodapé de totais e colunas
  configuráveis (preferência salva em `localStorage`).
- **Formulário de lançamento**: 3 seções + painel de resumo fixo à direita (empilhado no celular).

### Painel herói (`components/dashboard/hero-panel.tsx`)

O **único** elemento de alto contraste da interface: fundo escuro na cor da marca
(`.surface-hero` com gradiente radial + `.dot-grid`), número em `display-number`
(36–46px), variação contra o período anterior, sparkline dos últimos 12 meses e um rodapé com
comissão bruta, repasses e nº de entradas.

Usar com parcimônia — no máximo um por tela. Se tudo grita, nada é lido.

### Busca de comandos (⌘K)

`components/ui/command-palette.tsx`, escrita sem dependência extra: navegação, criação de
lançamento, PDFs, períodos do dashboard e atalho para cada mês do ano. Busca sem acento e sem
diferenciar caixa; navegação por setas, `↵` e `esc`.

### Barras de proporção e faixa de meses

- `ShareBar` mostra a participação de cada corretor nos repasses (`sparkline.tsx`);
- `MonthStrip` compara os 12 meses pela altura da barra em relação ao melhor mês, destacando o
  recorde e marcando meses fechados — leitura de sazonalidade que 12 cards idênticos não davam.

## Movimento

Curto, discreto e sempre opcional:

| Recurso | Onde | Duração |
| --- | --- | --- |
| `.animate-enter` | Diálogos, formulário de login | 420ms |
| `.stagger > *` | Blocos do dashboard (40ms de defasagem) | 420ms |
| `.hover-lift` | Cards clicáveis (meses) | 120ms |
| `.press` | Botões | 120ms |
| Gráficos | Recharts, `animationDuration: 620` | 620ms |

`prefers-reduced-motion` zera todas as durações e desliga o `hover-lift`.

**Decisão registrada:** não usamos contagem animada de números. O valor final é sempre renderizado
no servidor — em um sistema financeiro, um "R$ 0,00" transitório (ou permanente, se o JavaScript
falhar) é pior do que a ausência de animação.

## Gráficos

Recharts com legenda própria (a legenda padrão é um dos maiores indícios de template):

- grid horizontal pontilhado, sem linhas verticais nem eixos visíveis;
- eixo Y em moeda compacta (`R$ 15 mil`);
- tooltip própria, com moeda formatada em pt-BR;
- barras com `maxBarSize` e canto arredondado; barra vermelha quando a receita é negativa;
- rosca de composição com a margem líquida no centro.

## Estados obrigatórios

Toda tela tem: carregamento (`loading.tsx` com skeleton específico), vazio (`EmptyState`),
sem resultados (variante `icon="search"`), erro (`app/(app)/error.tsx`), não encontrado
(`not-found.tsx`), sem permissão (aviso em Configurações) e confirmação destrutiva em diálogo.

## Acessibilidade

- Foco visível global (`:focus-visible` com 2px na cor da marca).
- Rótulos reais em todos os campos; erro associado por `aria-describedby` e `role="alert"`.
- Tabelas com `<caption class="sr-only">`, `<th scope="col">` e rodapé semântico.
- Diálogos e menus via Radix (foco preso, `Esc`, retorno de foco).
- Botões só com ícone têm `aria-label`; navegação marca `aria-current="page"`.
- `prefers-reduced-motion` desliga animações e transições.
- Tooltips são acionáveis por teclado (são `<button>`, não `title`).

## Responsividade

Prioridade desktop → tablet → celular, sem esconder ações importantes:

- sidebar vira gaveta com overlay;
- grids colapsam de 4 → 2 → 1 coluna;
- tabelas rolam horizontalmente dentro do card (`overflow-x-auto`), a página nunca rola lateralmente;
- painel de resumo do formulário passa a ficar abaixo do formulário.

## Impressão

Relatórios oficiais são PDFs gerados no servidor. Ainda assim, `@media print` limpa fundos, remove
sombras e evita quebra dentro de cards para a visão mensal.
