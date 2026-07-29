"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/configuracoes/empresa", label: "Empresa e marca" },
  { href: "/configuracoes/financeiro", label: "Padrões financeiros" },
  { href: "/configuracoes/relatorios", label: "Relatórios" },
  { href: "/configuracoes/usuarios", label: "Usuários" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções de configuração">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-control px-3 py-2 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
