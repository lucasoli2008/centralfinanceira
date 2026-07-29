"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Building2,
  CalendarRange,
  CornerDownLeft,
  FileBarChart,
  History,
  KeyRound,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MONTH_NAMES } from "@/lib/formatting/date";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords?: string;
}

/** Comparação sem acento e sem diferenciar caixa. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function buildCommands(): Command[] {
  const today = new Date();
  const year = today.getFullYear();

  const base: Command[] = [
    { id: "nova-venda", label: "Registrar nova venda", group: "Criar", icon: Plus, href: "/vendas/nova", keywords: "lancamento comissao imovel" },
    { id: "nova-locacao", label: "Registrar nova locação", group: "Criar", icon: Plus, href: "/locacoes/nova", keywords: "aluguel primeiro" },
    { id: "novo-corretor", label: "Cadastrar corretor", group: "Criar", icon: Users, href: "/corretores", keywords: "equipe repasse" },

    { id: "dashboard", label: "Dashboard", group: "Navegar", icon: LayoutDashboard, href: "/dashboard", keywords: "inicio visao geral" },
    { id: "vendas", label: "Vendas", group: "Navegar", icon: Building2, href: "/vendas" },
    { id: "locacoes", label: "Locações", group: "Navegar", icon: KeyRound, href: "/locacoes" },
    { id: "corretores", label: "Corretores", group: "Navegar", icon: Users, href: "/corretores" },
    { id: "meses", label: "Visão anual dos meses", group: "Navegar", icon: CalendarRange, href: "/meses" },
    { id: "relatorios", label: "Relatórios", group: "Navegar", icon: FileBarChart, href: "/relatorios" },
    { id: "importar", label: "Importar planilha", group: "Navegar", icon: Upload, href: "/importar" },
    { id: "auditoria", label: "Auditoria", group: "Navegar", icon: History, href: "/auditoria" },
    { id: "lixeira", label: "Registros excluídos", group: "Navegar", icon: Trash2, href: "/lixeira", keywords: "lixeira restaurar" },
    { id: "configuracoes", label: "Configurações", group: "Navegar", icon: Settings, href: "/configuracoes/empresa", keywords: "marca padroes" },

    { id: "pdf-mensal", label: `PDF do mês atual`, hint: MONTH_NAMES[today.getMonth()], group: "Relatórios", icon: FileBarChart, href: `/api/relatorios/mensal?ano=${year}&mes=${today.getMonth() + 1}` },
    { id: "pdf-anual", label: `PDF anual de ${year}`, group: "Relatórios", icon: FileBarChart, href: `/api/relatorios/anual?ano=${year}` },

    { id: "periodo-mes", label: "Dashboard: este mês", group: "Períodos", icon: CalendarRange, href: "/dashboard?periodo=este-mes" },
    { id: "periodo-3", label: "Dashboard: últimos 3 meses", group: "Períodos", icon: CalendarRange, href: "/dashboard?periodo=ultimos-3-meses" },
    { id: "periodo-ano", label: "Dashboard: ano atual", group: "Períodos", icon: CalendarRange, href: "/dashboard?periodo=ano-atual" },
  ];

  // Atalho direto para cada mês do ano corrente.
  const months = MONTH_NAMES.map((name, index) => ({
    id: `mes-${index + 1}`,
    label: `${name} de ${year}`,
    group: "Meses",
    icon: CalendarRange,
    href: `/meses/${year}/${index + 1}`,
    keywords: "visao mensal fechamento",
  }));

  return [...base, ...months];
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const commands = React.useMemo(() => buildCommands(), []);

  // Cada resultado já sabe se abre um novo grupo — evita mutar variável durante
  // a renderização da lista.
  const results = React.useMemo(() => {
    const term = normalize(query.trim());

    const matched = term
      ? commands
          .filter((command) =>
            normalize(`${command.label} ${command.group} ${command.keywords ?? ""}`).includes(term),
          )
          .slice(0, 12)
      : commands.slice(0, 9);

    return matched.map((command, index) => ({
      command,
      startsGroup: index === 0 || matched[index - 1].group !== command.group,
    }));
  }, [commands, query]);

  // Índice ativo derivado dos resultados, sem efeito.
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function run(command: Command) {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);

    if (command.href.startsWith("/api/")) {
      window.open(command.href, "_blank", "noopener,noreferrer");
      return;
    }

    router.push(command.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % Math.max(results.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % Math.max(results.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[safeIndex];
      if (result) run(result.command);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group hidden h-8 items-center gap-2 rounded-control border border-border bg-surface-sunken px-2.5 text-[12.5px] text-subtle transition-colors hover:border-border-strong hover:text-muted sm:flex"
        aria-label="Abrir busca de comandos"
      >
        <Search className="size-3.5" />
        <span className="pr-6">Buscar ou navegar…</span>
        <span className="kbd">⌘K</span>
      </button>

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setActiveIndex(0);
          }
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(15_15_14/0.32)] backdrop-blur-[2px] animate-fade-in" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface shadow-popover focus:outline-none animate-enter"
            aria-label="Comandos"
          >
            <DialogPrimitive.Title className="sr-only">
              Buscar comandos e páginas
            </DialogPrimitive.Title>

            <div className="flex items-center gap-2.5 border-b border-border px-3.5">
              <Search className="size-4 shrink-0 text-subtle" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Buscar página, mês ou ação…"
                className="h-12 w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle"
                aria-label="Buscar comandos"
              />
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-[12.5px] text-muted">
                  Nada encontrado para “{query}”.
                </p>
              ) : (
                <ul role="listbox" aria-label="Resultados">
                  {results.map(({ command, startsGroup }, index) => {
                    const isActive = index === safeIndex;
                    const Icon = command.icon;

                    return (
                      <React.Fragment key={command.id}>
                        {startsGroup ? (
                          <li className="label-overline px-2.5 pb-1 pt-2.5" aria-hidden="true">
                            {command.group}
                          </li>
                        ) : null}
                        <li>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => run(command)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[13px] transition-colors",
                              isActive ? "bg-accent-soft text-accent" : "text-foreground",
                            )}
                          >
                            <Icon
                              className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-subtle")}
                            />
                            <span className="flex-1 truncate">{command.label}</span>
                            {command.hint ? (
                              <span className="text-[11.5px] text-subtle">{command.hint}</span>
                            ) : null}
                            {isActive ? (
                              <CornerDownLeft className="size-3.5 shrink-0 opacity-60" />
                            ) : null}
                          </button>
                        </li>
                      </React.Fragment>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-border bg-surface-sunken px-3.5 py-2 text-[11px] text-subtle">
              <span className="flex items-center gap-1">
                <span className="kbd">↑</span>
                <span className="kbd">↓</span>
                navegar
              </span>
              <span className="flex items-center gap-1">
                <span className="kbd">↵</span>
                abrir
              </span>
              <span className="ml-auto flex items-center gap-1">
                <span className="kbd">esc</span>
                fechar
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
