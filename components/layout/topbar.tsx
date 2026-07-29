"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown, KeyRound, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { CommandPalette } from "@/components/ui/command-palette";
import { MobileNav, type ShellIdentity } from "./sidebar";

/** Rótulo da seção atual, para o usuário sempre saber onde está. */
const SECTION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/dashboard", label: "Dashboard" },
  { prefix: "/vendas", label: "Vendas" },
  { prefix: "/locacoes", label: "Locações" },
  { prefix: "/corretores", label: "Corretores" },
  { prefix: "/meses", label: "Meses" },
  { prefix: "/relatorios", label: "Relatórios" },
  { prefix: "/importar", label: "Importar planilha" },
  { prefix: "/auditoria", label: "Auditoria" },
  { prefix: "/lixeira", label: "Lixeira" },
  { prefix: "/configuracoes", label: "Configurações" },
];

export function Topbar(identity: ShellIdentity) {
  const pathname = usePathname();
  const section = SECTION_LABELS.find(
    (item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`),
  );

  return (
    <header className="sticky top-0 z-30 flex h-13 min-h-[52px] items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur-md lg:px-6">
      <MobileNav {...identity} />

      <nav aria-label="Localização atual" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-[12.5px]">
          <li className="hidden text-subtle sm:block">{identity.organizationName}</li>
          <li className="hidden text-subtle sm:block" aria-hidden="true">
            /
          </li>
          <li className="truncate font-medium text-foreground">{section?.label ?? "Central Financeira"}</li>
        </ol>
      </nav>

      <CommandPalette />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-control bg-accent px-2.5 text-[13px] font-medium text-accent-foreground shadow-card transition-colors hover:bg-accent-hover"
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Novo lançamento</span>
            <span className="sm:hidden">Novo</span>
            <ChevronDown className="size-3.5 opacity-80" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href="/vendas/nova">
              <Building2 />
              Nova venda
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/locacoes/nova">
              <KeyRound />
              Nova locação
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
