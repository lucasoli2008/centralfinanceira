"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building, CalendarDays, Lightbulb, LineChart, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Menu do Controle Financeiro, enxuto: o dia a dia acontece dentro de cada mês
 * (Visão do ano → mês). As telas antigas (lançamentos, a pagar, DRE...) seguem
 * acessíveis por links internos e pelos alertas.
 */
const ITEMS: { href: string; label: string; icon: typeof CalendarDays; match: string[] }[] = [
  {
    href: "/financeiro",
    label: "Meses do ano",
    icon: CalendarDays,
    match: ["/financeiro", "/financeiro/mes", "/financeiro/lancamentos", "/financeiro/a-pagar", "/financeiro/a-receber", "/financeiro/conciliacao", "/financeiro/dre", "/financeiro/fechamento", "/financeiro/painel"],
  },
  { href: "/financeiro/fluxo", label: "Fluxo de caixa", icon: LineChart, match: ["/financeiro/fluxo"] },
  { href: "/financeiro/imobiliario", label: "Aluguéis e comissões", icon: Building, match: ["/financeiro/imobiliario"] },
  { href: "/financeiro/inteligencia", label: "Alertas", icon: Lightbulb, match: ["/financeiro/inteligencia"] },
  { href: "/financeiro/cadastros", label: "Configurações", icon: Settings2, match: ["/financeiro/cadastros", "/financeiro/automacao"] },
];

export function FinanceNav() {
  const pathname = usePathname();
  const isActive = (item: (typeof ITEMS)[number]) =>
    item.match.some((prefix) => (prefix === "/financeiro" ? pathname === prefix : pathname === prefix || pathname.startsWith(`${prefix}/`)));

  return (
    <nav aria-label="Módulos do Controle Financeiro" className="-mx-4 mb-6 border-b border-border px-4 lg:mx-0 lg:px-0">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active ? "border-accent text-foreground" : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
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
