"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Building,
  Gauge,
  Library,
  Lightbulb,
  LineChart,
  Lock,
  Table2,
  ListChecks,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/financeiro", label: "Painel", icon: Gauge, exact: true },
  { href: "/financeiro/inteligencia", label: "Inteligência", icon: Lightbulb },
  { href: "/financeiro/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  { href: "/financeiro/a-pagar", label: "A pagar", icon: ArrowUpFromLine },
  { href: "/financeiro/a-receber", label: "A receber", icon: ArrowDownToLine },
  { href: "/financeiro/conciliacao", label: "Conciliação", icon: ListChecks },
  { href: "/financeiro/imobiliario", label: "Imobiliário", icon: Building },
  { href: "/financeiro/fluxo", label: "Fluxo de caixa", icon: LineChart },
  { href: "/financeiro/dre", label: "DRE", icon: Table2 },
  { href: "/financeiro/fechamento", label: "Fechamento", icon: Lock },
  { href: "/financeiro/automacao", label: "Automação", icon: Wand2 },
  { href: "/financeiro/cadastros", label: "Cadastros", icon: Library },
];

/** Subnavegação do Controle Financeiro — rolável no celular, fixa no topo da seção. */
export function FinanceNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Módulos do Controle Financeiro" className="-mx-4 mb-6 border-b border-border px-4 lg:mx-0 lg:px-0">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3.5", active ? "text-accent" : "text-subtle")} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
